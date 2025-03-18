package collect

import (
	"benritz/gilts/internal/types"

	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/parquet-go/parquet-go"
)

type Collector interface {
	Collect(ctx context.Context) ([]*types.Gilt, error)
	Source() string
}

func StoreToWriter(gilts []*types.Gilt, output io.Writer) error {
	writer := parquet.NewGenericWriter[*types.Gilt](output)
	defer writer.Close()

	if _, err := writer.Write(gilts); err != nil {
		return fmt.Errorf("failed to write records: %w", err)
	}

	return nil
}

func StoreToPath(gilts []*types.Gilt, path string) error {
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	return StoreToWriter(gilts, file)
}

func CollectToWriter(ctx context.Context, collector Collector, output io.Writer) error {
	data, err := collector.Collect(ctx)
	if err != nil {
		return fmt.Errorf("failed to collect data: %v", err)
	}

	fmt.Printf("Collected %d records\n", len(data))

	if err := StoreToWriter(data, output); err != nil {
		return fmt.Errorf("failed to save data to parquet format: %v", err)
	}

	return nil
}

func CollectToPath(ctx context.Context, collector Collector, basepath string) error {
	date := time.Now()

	path := fmt.Sprintf(
		"%s%c%04d%c%02d%c%02d",
		basepath,
		filepath.Separator,
		date.UTC().Year(),
		filepath.Separator,
		date.UTC().Month(),
		filepath.Separator,
		date.UTC().Day(),
	)

	if err := os.MkdirAll(path, os.ModePerm); err != nil {
		return err
	}

	name := fmt.Sprintf("%s%c%s.parquet", path, filepath.Separator, collector.Source())

	file, err := os.Create(name)
	if err != nil {
		return err
	}
	defer file.Close()

	if err := CollectToWriter(ctx, collector, file); err != nil {
		return fmt.Errorf("failed to collect data: %v", err)
	}

	return nil
}

type S3Path struct {
	Bucket string
	Prefix string
}

func ParseS3(path string) (*S3Path, error) {
	if !strings.HasPrefix(path, "s3://") {
		return nil, fmt.Errorf("path must start with s3://")
	}

	path = strings.TrimPrefix(path, "s3://")
	parts := strings.SplitN(path, "/", 2)

	bucket := parts[0]

	var prefix string

	if len(parts) > 1 {
		prefix = parts[1]
		prefix = strings.TrimSuffix(prefix, "/")
	} else {
		prefix = ""
	}

	return &S3Path{
		Bucket: bucket,
		Prefix: prefix,
	}, nil
}

func CollectToS3(ctx context.Context, collector Collector, s3Client *s3.Client, dst *S3Path) error {
	date := time.Now()

	tmp, err := os.CreateTemp("", "gilt-*.parquet")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %v", err)
	}
	defer tmp.Close()
	defer os.Remove(tmp.Name())

	if err := CollectToWriter(ctx, collector, tmp); err != nil {
		return fmt.Errorf("failed to collect data: %v", err)
	}

	if _, err := tmp.Seek(0, 0); err != nil {
		return fmt.Errorf("failed to seek to start of file: %w", err)
	}

	fmt.Printf("Saved data to %s\n", tmp.Name())
	if stat, err := os.Stat(tmp.Name()); err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	} else {
		fmt.Printf("File size: %d bytes\n", stat.Size())
	}

	key := fmt.Sprintf(
		"%04d/%02d/%02d/%s.parquet",
		date.UTC().Year(),
		date.UTC().Month(),
		date.UTC().Day(),
		collector.Source(),
	)

	if dst.Prefix != "" {
		key = fmt.Sprintf("%s/%s", dst.Prefix, key)
	}

	input := &s3.PutObjectInput{
		Bucket: aws.String(dst.Bucket),
		Key:    aws.String(key),
		Body:   tmp,
	}

	if _, err := s3Client.PutObject(ctx, input); err != nil {
		return fmt.Errorf("failed to upload file to s3://%s/%s: %w", dst.Bucket, key, err)
	}

	return nil
}
