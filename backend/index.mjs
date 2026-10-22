import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const dynamoClient = new DynamoDBClient({})
const documentClient = DynamoDBDocumentClient.from(dynamoClient)
const s3Client = new S3Client({})
const snsClient = new SNSClient({})
const notificationTopicArn = 'arn:aws:sns:ap-south-1:690640933182:CampusLostFoundNotifications'
const requiredFields = ['type', 'name', 'category', 'location', 'description', 'contactEmail']
const allowedTypes = new Set(['lost', 'found'])
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const maxPhotoBytes = 5 * 1024 * 1024

const jsonHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://localhost:5173',
  'Content-Type': 'application/json',
}

const response = (statusCode, body) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
})

const getMethod = (event) => event?.requestContext?.http?.method || event?.httpMethod || ''
const getPath = (event) => event?.requestContext?.http?.path || event?.rawPath || event?.path || event?.resource || ''

const parseBody = (event) => {
  if (!event?.body) return null
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
  return typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody
}

const validateItem = (body) => {
  const missingFields = requiredFields.filter((field) => {
    return typeof body?.[field] !== 'string' || body[field].trim() === ''
  })

  if (missingFields.length > 0) {
    return `Missing required field${missingFields.length > 1 ? 's' : ''}: ${missingFields.join(', ')}`
  }

  if (!allowedTypes.has(body.type.trim().toLowerCase())) {
    return 'The type field must be either "lost" or "found".'
  }

  return null
}

const getPhotoUrl = async (photoKey) => {
  if (!photoKey || photoKey.startsWith('http')) return photoKey || ''
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: photoKey }), { expiresIn: 900 })
}

const getItemsWithPhotoUrls = async (items) => Promise.all(items.map(async (item) => ({
  ...item,
  photoUrl: await getPhotoUrl(item.photoUrl),
})))

const validateUpload = (body) => {
  if (!body || typeof body.data !== 'string' || !body.data) return 'A photo is required.'
  if (!allowedImageTypes.has(body.contentType)) return 'Only JPG, PNG, WEBP, and GIF photos are supported.'
  if (Buffer.byteLength(body.data, 'base64') > maxPhotoBytes) return 'Photo must be 5 MB or smaller.'
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) return 'The photo data is invalid.'
  return null
}

const uploadPhoto = async (body, bucketName) => {
  const validationError = validateUpload(body)
  if (validationError) return { error: validationError }

  const extension = body.contentType.split('/')[1].replace('jpeg', 'jpg')
  const photoKey = `items/${randomUUID()}.${extension}`
  const photoBuffer = Buffer.from(body.data, 'base64')
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: photoKey,
    Body: photoBuffer,
    ContentType: body.contentType,
    ServerSideEncryption: 'AES256',
  }))

  return { key: photoKey, photoUrl: photoKey }
}

const publishItemNotification = async (item) => {
  const message = [
    'A new Campus Lost & Found item was reported.',
    '',
    `Title: ${item.name}`,
    `Status: ${item.type === 'lost' ? 'Lost' : 'Found'}`,
    `Location: ${item.location}`,
    `Description: ${item.description}`,
  ].join('\n')

  try {
    await snsClient.send(new PublishCommand({
      TopicArn: notificationTopicArn,
      Subject: `Campus Lost & Found: ${item.name}`.slice(0, 100),
      Message: message,
    }))
  } catch (error) {
    console.error('SNS notification failed after item was saved', error)
  }
}

export const handler = async (event) => {
  const method = getMethod(event).toUpperCase()
  const path = getPath(event)
  const tableName = process.env.TABLE_NAME

  if (method === 'OPTIONS') {
    return response(204, {})
  }

  if (path.endsWith('/upload')) {
    if (method !== 'POST') return response(405, { message: 'Method not allowed.' })
    if (!process.env.BUCKET_NAME) {
      console.error('BUCKET_NAME is not configured')
      return response(500, { message: 'Server configuration error.' })
    }

    try {
      let body
      try {
        body = parseBody(event)
      } catch {
        return response(400, { message: 'Request body must be valid JSON.' })
      }
      const result = await uploadPhoto(body, process.env.BUCKET_NAME)
      if (result.error) return response(400, { message: result.error })
      return response(201, result)
    } catch (error) {
      console.error('S3 photo upload failed', error)
      return response(500, { message: 'Unable to upload the photo.' })
    }
  }

  if (!tableName) {
    console.error('TABLE_NAME is not configured')
    return response(500, { message: 'Server configuration error.' })
  }

  if (!process.env.BUCKET_NAME) {
    console.error('BUCKET_NAME is not configured')
    return response(500, { message: 'Server configuration error.' })
  }

  try {
    if (method === 'GET') {
      const result = await documentClient.send(new ScanCommand({
        TableName: tableName,
      }))

      const items = (result.Items || []).sort((first, second) => {
        return String(second.createdAt).localeCompare(String(first.createdAt))
      })

      return response(200, { items: await getItemsWithPhotoUrls(items) })
    }

    if (method === 'POST') {
      let body
      try {
        body = parseBody(event)
      } catch {
        return response(400, { message: 'Request body must be valid JSON.' })
      }

      const validationError = validateItem(body)
      if (validationError) {
        return response(400, { message: validationError })
      }

      const item = {
        id: randomUUID(),
        type: body.type.trim().toLowerCase(),
        name: body.name.trim(),
        category: body.category.trim(),
        location: body.location.trim(),
        description: body.description.trim(),
        contactEmail: body.contactEmail.trim(),
        photoUrl: typeof body.photoUrl === 'string' ? body.photoUrl.trim() : '',
        createdAt: new Date().toISOString(),
      }

      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: item,
      }))

      await publishItemNotification(item)

      return response(201, { item })
    }

    return response(405, { message: 'Method not allowed.' })
  } catch (error) {
    console.error('DynamoDB request failed', error)
    return response(500, { message: 'Unable to process the request.' })
  }
}
