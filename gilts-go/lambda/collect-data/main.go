package main

import (
	"benritz/gilts/internal/collect"

	"context"
	"fmt"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

var (
	ENV_BUCKET_NAME = "GILTS_DATA_BUCKET_NAME"
)

func collectData() error {
	bucketName := os.Getenv(ENV_BUCKET_NAME)
	if bucketName == "" {
		return fmt.Errorf("%s is not set", ENV_BUCKET_NAME)
	}

	path := &collect.S3Path{
		Bucket: bucketName,
		Prefix: "",
	}

	ctx := context.Background()

	// collector := collect.NewDataDividendCollector()
	collector := collect.NewDMOCollector()

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to load config: %v", err)
	}

	s3Client := s3.NewFromConfig(cfg)

	if err := collect.CollectToS3(ctx, collector, s3Client, path); err != nil {
		return err
	}

	return nil
}

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
	err := collectData()

	if err != nil && len(request.Records) > 0 {
		// should just have a single record, ignore the rest
		rec := request.Records[0]
		return responseWithFailure(rec), fmt.Errorf("failed to collect data: %v", err)
	}

	return events.SQSEventResponse{}, nil
}

func main() {
	lambda.Start(handler)
}
