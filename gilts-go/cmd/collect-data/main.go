package main

import (
	"benritz/gilts/internal/collect"
	"benritz/gilts/internal/types"
	"time"

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

func storeToS3(
	ctx context.Context,
	collected *collect.CollectedBonds,
	profile string,
	s3Path *collect.S3Path,
) (string, error) {
	cfg, err := getAwsConfig(ctx, profile)
	if err != nil {
		return "", fmt.Errorf("failed to load AWS config: %v", err)
	}

	s3Client := s3.NewFromConfig(cfg)

	outPath, err := collect.StoreToS3(ctx, collected, s3Client, s3Path)
	if err != nil {
		return "", fmt.Errorf("failed to store data to S3: %v", err)
	}

	return outPath, nil
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

	collected, err := collector.Collect(ctx, time.Now())
	if err != nil {
		switch err {
		case types.ErrDataUnavailable:
			fmt.Printf("Data unavailable\n")
		default:
			fmt.Printf("Failed to collect data: %v\n", err)
		}
		os.Exit(1)
	}

	var outPath string
	if s3Path, _ := collect.ParseS3(dst); s3Path != nil {
		outPath, err = storeToS3(ctx, collected, *profile, s3Path)
	} else {
		outPath, err = collect.StoreToPath(ctx, collected, dst)
	}

	if err != nil {
		fmt.Printf("Failed to store data: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Stored to %s\n", outPath)
}
