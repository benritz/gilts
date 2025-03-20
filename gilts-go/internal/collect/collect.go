package collect

import (
	"benritz/gilts/internal/types"
	"path/filepath"
	"time"

	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/parquet-go/parquet-go"
)

var (
	ErrInvaidRow = fmt.Errorf("invalid row")
)

type CollectedBond struct {
	Bond *types.Bond
	Err  error
}

func (c *CollectedBond) SetError(err error) {
	if c.Err != nil {
		c.Err = err
	}
}

type CollectedBonds struct {
	Bonds          []*types.Bond
	Failures       []*CollectedBond
	Source         string
	SettlementDate time.Time
}

func (c *CollectedBonds) AddBond(cb *CollectedBond) {
	if cb.Err == nil {
		c.Bonds = append(c.Bonds, cb.Bond)
	} else {
		c.Failures = append(c.Failures, cb)
	}
}

func NewCollectedBonds(source string, date time.Time) *CollectedBonds {
	return &CollectedBonds{
		Source:         source,
		SettlementDate: date,
		Bonds:          []*types.Bond{},
		Failures:       []*CollectedBond{},
	}
}

type Collector interface {
	Collect(ctx context.Context, date time.Time) (*CollectedBonds, error)
	Source() string
}

func writeBonds(bonds []*types.Bond, output io.Writer) error {
	writer := parquet.NewGenericWriter[*types.Bond](output)
	defer writer.Close()

	if _, err := writer.Write(bonds); err != nil {
		return fmt.Errorf("failed to write records: %w", err)
	}

	return nil
}

func StoreToPath(ctx context.Context, collected *CollectedBonds, basepath string) (string, error) {
	date := collected.SettlementDate

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
		return "", err
	}

	outPath := fmt.Sprintf("%s%c%s.parquet", path, filepath.Separator, collected.Source)

	file, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	if err := writeBonds(collected.Bonds, file); err != nil {
		return "", err
	}

	return outPath, nil
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

func StoreToS3(ctx context.Context, collected *CollectedBonds, s3Client *s3.Client, dst *S3Path) (string, error) {
	tmp, err := os.CreateTemp("", "gilt-*.parquet")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %v", err)
	}
	defer tmp.Close()
	defer os.Remove(tmp.Name())

	if err := writeBonds(collected.Bonds, tmp); err != nil {
		return "", err
	}

	if _, err := tmp.Seek(0, 0); err != nil {
		return "", fmt.Errorf("failed to seek to start of file: %w", err)
	}

	date := collected.SettlementDate

	key := fmt.Sprintf(
		"%04d/%02d/%02d/%s.parquet",
		date.UTC().Year(),
		date.UTC().Month(),
		date.UTC().Day(),
		collected.Source,
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
		return "", fmt.Errorf("failed to upload file to s3://%s/%s: %w", dst.Bucket, key, err)
	}

	outPath := fmt.Sprintf("s3://%s/%s", dst.Bucket, key)

	return outPath, nil
}
