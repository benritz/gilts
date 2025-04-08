#!/usr/bin/env bash

# getting details
echo "Getting deploy details from stack"

if [ -z "$AWS_PROFILE" ]; then
    PROFILE=""
else
    PROFILE="--profile $AWS_PROFILE"
fi

STACK_OUTPUTS=$(aws $PROFILE cloudformation describe-stacks --stack-name GiltsStack --output json | jq '.Stacks[0].Outputs')

DISTRIBUTION_ID=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.ExportName=="WebAppDistributionId") | .OutputValue')
BUCKET_NAME=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.ExportName=="WebAppBucketName") | .OutputValue')
DOMAIN_NAME=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.ExportName=="WebAppDomainName") | .OutputValue')

if [ -z "$DISTRIBUTION_ID" ]; then
  echo "Couldn't get distribution ID from stack"
  exit 1
fi

if [ -z "$BUCKET_NAME" ]; then
  echo "Couldn't get bucket name from stack"
  exit 1
fi

if [ -z "$DOMAIN_NAME" ]; then
  echo "Couldn't get domain name from stack"
  exit 1
fi

echo

# build
echo "Building site"

npm run build

if [ $? -ne 0 ]; then
  echo "Build failed"
  exit 1
fi

echo

# deploying
echo "Deploying"

aws $PROFILE s3 sync ./dist/ "s3://$BUCKET_NAME/" --delete

if [ $? -ne 0 ]; then
  echo "Sync to S3 failed"
  exit 1
fi

echo

# invalidating distribution
echo "Invalidating distribution"

INVALIDATION=$(aws $PROFILE cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*")

INVALIDATION_ID=$(echo $INVALIDATION | jq -r '.Invalidation.Id')
INVALIDATION_STATUS=$(echo $INVALIDATION | jq -r '.Invalidation.Status')

if [ -z "$INVALIDATION_ID" ]; then
  echo "Couldn't get invalidation ID"
  exit 1
fi

if [ -z "$INVALIDATION_STATUS" ]; then
  echo "Couldn't get invalidation status"
  exit 1
fi

while [ "$INVALIDATION_STATUS" != "Completed" ]; do
  echo "Invalidation $INVALIDATION_STATUS"
  sleep 5
  INVALIDATION=$(aws $PROFILE cloudfront get-invalidation --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID")  
  INVALIDATION_STATUS=$(echo $INVALIDATION | jq -r '.Invalidation.Status')

    if [ -z "$INVALIDATION_STATUS" ]; then
    echo "Couldn't get invalidation status"
    exit 1
    fi
done

echo "Invalidation $INVALIDATION_STATUS"
echo

echo "Deploy complete"
echo "Goto https://$DOMAIN_NAME"