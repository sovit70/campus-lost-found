# Campus Lost & Found Backend

AWS Lambda backend for the `CampusItems` DynamoDB table, private `campus-lost-found-portal` S3 bucket, and `CampusLostFoundNotifications` SNS topic. The handler supports API Gateway `GET /items`, `POST /items`, `POST /upload`, and CORS preflight `OPTIONS` requests.

## Runtime and configuration

- Runtime: **Node.js 24.x**
- Handler: `index.handler`
- DynamoDB table environment variable: `TABLE_NAME` (required)
- Optional CORS environment variable: `CORS_ORIGIN`
  - Defaults to `http://localhost:5173` for local Vite development.
  - Set it to the deployed frontend origin, or an API Gateway/frontend origin appropriate for your deployment.

The Lambda execution role needs permission to call `dynamodb:Scan` and `dynamodb:PutItem` on the `CampusItems` table, plus `s3:PutObject` and `s3:GetObject` on the `campus-lost-found-portal` bucket. Do not put AWS credentials in this project. Lambda uses its execution role and the AWS SDK's default credential provider chain.

After an item is saved successfully, Lambda publishes a notification to `arn:aws:sns:ap-south-1:690640933182:CampusLostFoundNotifications`. SNS errors are logged without failing the already-successful item response.

## API

### GET `/items`

Returns all stored reports, newest first:

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "lost",
      "name": "Black wallet",
      "category": "Personal items",
      "location": "Library",
      "description": "Small black leather wallet.",
      "contactEmail": "student@example.edu",
      "photoUrl": "",
      "createdAt": "2026-10-22T12:00:00.000Z"
    }
  ]
}
```

### POST `/items`

Required JSON fields: `type`, `name`, `category`, `location`, `description`, and `contactEmail`.

`type` must be `lost` or `found`. `photoUrl` is optional and defaults to an empty string. For private uploaded photos, it stores an S3 object key. `GET /items` converts stored keys into signed URLs that expire after 15 minutes.

Example request body:

```json
{
  "type": "found",
  "name": "Blue backpack",
  "category": "Bags",
  "location": "North quad",
  "description": "Canvas backpack with an astronomy patch.",
  "contactEmail": "student@example.edu",
  "photoUrl": "https://example.com/backpack.jpg"
}
```

### POST `/upload`

Uploads one private image to S3 and returns its object key. The request body is JSON:

```json
{
  "contentType": "image/jpeg",
  "fileName": "wallet.jpg",
  "data": "base64-encoded-image-data"
}
```

Supported types are JPG, PNG, WEBP, and GIF. Images must be 5 MB or smaller. The response includes a key such as `items/uuid.jpg`; send that key as `photoUrl` when creating the item.

Responses include JSON and these CORS headers:

- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Headers: Content-Type`
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`

## Deploy with the AWS Console

1. Create or confirm a DynamoDB table named `CampusItems` with `id` as the partition key (String).
2. Install the backend dependencies and create the deployment zip from this folder:

   ```powershell
   cd backend
   npm install
   npm run zip
   ```

   `lambda.zip` contains `index.mjs`, `package.json`, and `node_modules`.
3. Create an AWS Lambda function with the **Node.js 24.x** runtime.
4. Set the handler to `index.handler`.
5. Upload `lambda.zip` under **Code**.
6. Add environment variables `TABLE_NAME=CampusItems` and `BUCKET_NAME=campus-lost-found-portal`.
7. Optionally add `CORS_ORIGIN` for your deployed frontend origin. Keep the default for local Vite development.
8. Attach an execution role with `dynamodb:Scan` and `dynamodb:PutItem` permission for the table, plus `s3:PutObject` and `s3:GetObject` for `arn:aws:s3:::campus-lost-found-portal/items/*`, and `sns:Publish` for `arn:aws:sns:ap-south-1:690640933182:CampusLostFoundNotifications`.
9. Keep the S3 bucket private. Do not enable public access or add a public bucket policy. Lambda generates temporary signed read URLs.
10. Connect the function to an API Gateway HTTP API. Add `GET /items`, `POST /items`, and `POST /upload` routes. Configure API Gateway CORS for the frontend origin with `GET,POST,OPTIONS` and `Content-Type`.

For a fresh deployment package, use `npm ci` instead of `npm install` after `package-lock.json` has been created:

```powershell
cd backend
npm ci --omit=dev
npm run zip
```

The frontend keeps the existing design and sends photos through `POST /upload` before saving the returned S3 key with the item through `POST /items`.
