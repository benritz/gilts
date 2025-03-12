package main

import (
	collect "benritz/gilts/internal"
	"context"
	"fmt"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

var (
	ENV_BUCKET_NAME = "GILTS_DATA_BUCKET_NAME"
)

func responseWithFailure(rec events.SQSMessage) events.SQSEventResponse {
	return events.SQSEventResponse{
		BatchItemFailures: []events.SQSBatchItemFailure{
			{
				ItemIdentifier: rec.MessageId,
			},
		},
	}
}

func handler(request events.SQSEvent) (events.SQSEventResponse, error) {
	if len(request.Records) > 0 {
		// should just have a single record
		// ignore the rest
		rec := request.Records[0]

		bucketName := os.Getenv(ENV_BUCKET_NAME)
		if bucketName == "" {
			return responseWithFailure(rec), fmt.Errorf("%s is not set", ENV_BUCKET_NAME)
		}

		ctx := context.Background()
		if err := collect.CollectToS3(ctx, bucketName); err != nil {
			return responseWithFailure(rec), fmt.Errorf("failed to collect data: %v", err)
		}
	}

	return events.SQSEventResponse{}, nil
}

func main() {
	lambda.Start(handler)
}
