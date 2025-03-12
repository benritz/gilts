package main

import (
	"benritz/gilts/internal/collect"

	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	_ "github.com/pbnjay/grate/xls"
)

func getAwsConfig(ctx context.Context, profile string) (aws.Config, error) {
	if profile == "default" {
		return config.LoadDefaultConfig(ctx)
	}
	return config.LoadDefaultConfig(ctx, config.WithSharedConfigProfile(profile))
}

func collectToS3(
	ctx context.Context,
	collector collect.Collector,
	profile string,
	s3Path *collect.S3Path,
) error {
	cfg, err := getAwsConfig(ctx, profile)
	if err != nil {
		return fmt.Errorf("failed to load AWS config: %v", err)
	}

	s3Client := s3.NewFromConfig(cfg)

	if err := collect.CollectToS3(ctx, collector, s3Client, s3Path); err != nil {
		return fmt.Errorf("failed to collect data to S3: %v", err)
	}

	return nil
}

func main() {
	ctx := context.Background()

	profile := flag.String("profile", "default", "the AWS profile to use")
	helpFlag := flag.Bool("help", false, "print this help message")
	flag.Parse()
	args := flag.Args()

	if len(args) != 1 || *helpFlag {
		fmt.Printf("Usage: %s <flags> <destination>\n", filepath.Base(os.Args[0]))
		flag.PrintDefaults()
		os.Exit(1)
	}

	dst := args[0]

	// collector := collect.NewDividendDataCollector()
	collector := collect.NewDMOCollector()

	var err error

	if s3Path, _ := collect.ParseS3(dst); s3Path != nil {
		err = collectToS3(ctx, collector, *profile, s3Path)
	} else {
		err = collect.CollectToPath(ctx, collector, dst)
	}

	if err != nil {
		fmt.Printf("Failed to collect data: %v\n", err)
	} else {
		fmt.Printf("Data collected successfully to %s\n", dst)
	}
}
