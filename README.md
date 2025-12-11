# UK Gilt Yield Curve Visualisation Tool

A UK Government Bonds (Gilts) yield curve visualisation system. It collects
daily bond pricing data from the UK Debt Management Office (DMO), calculates
yield to maturity, and displays an interactive yield curve chart.

## Architecture

The project consists of three components:

- **gilts-go** - Go backend that fetches gilt data from the DMO, calculates
  yields using Newton-Raphson method, and stores results in Parquet format
- **gilts-web** - TypeScript/Vite web application displaying an interactive
  yield curve chart with historical data browsing
- **gilts-cdk** - AWS CDK infrastructure for the gilts data pipeline and web application.

Data is collected daily at 14:30 UTC (after DMO publishes prices), stored in
S3, and served via CloudFront to the browser-based visualisation.

## gilts-cdk

AWS CDK infrastructure for the gilts data pipeline and web application.

### Prerequisites

- Node.js
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS credentials configured

### Environment Variables

- `GILTS_GIT_REPO_URL` - Git repository URL for the project
- `GILTS_GIT_REPO_CONNECTION_ARN` - AWS CodeStar connection ARN for the
  repository

### Resources

The stack creates:

- **Data Collection** - Lambda function using container image scheduled using
  a SQS queue with a EventBridge schedule (weekdays 14:30 UTC)
- **Storage** - S3 bucket for data (Parquet files) and web app assets
- **Analytics** - Glue database/table and Athena workgroup for querying
  data
- **Web Hosting** - CloudFront distribution serving the web app and data files

### Commands

- `npm run build` - Compile TypeScript
- `npm run test` - Run tests
- `npx cdk deploy` - Deploy stack to AWS
- `npx cdk diff` - Compare deployed stack with current state
