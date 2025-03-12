package collect

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gocolly/colly/v2"
	"github.com/parquet-go/parquet-go"
)

type Gilt struct {
	CaptureDate   time.Time
	Ticker        string
	Desc          string
	Coupon        float64
	Price         float64
	MaturityDate  time.Time
	MaturityYears float64
	MaturityYield float64
}

func maturityYears(capture, maturity time.Time) float64 {
	years := maturity.Year() - capture.Year()

	t := time.Date(
		maturity.Year(),
		capture.Month(),
		capture.Day(),
		0,
		0,
		0,
		0,
		maturity.Location(),
	)

	if t.After(maturity) {
		years--
		t = t.AddDate(-1, 0, 0)
	}

	days := int(maturity.Sub(t).Hours() / 24)

	isLeapYear := func(year int) bool {
		return year%4 == 0 && (year%100 != 0 || year%400 == 0)
	}

	daysInYear := func(year int) int {
		if isLeapYear(year) {
			return 366
		}
		return 365
	}

	return float64(years) + float64(days)/float64(daysInYear(t.Year()))
}

var COL_TICKER = 0
var COL_DESC = 1
var COL_COUPON = 2
var COL_MATURITY_DATE = 3
var COL_MATURITY_DURATION = 4
var COL_PRICE = 5
var COL_MATURITY_YIELD = 6

func scrapeGilt(e *colly.HTMLElement) (*Gilt, error) {
	gilt := Gilt{CaptureDate: time.Now()}
	errs := []error{}

	e.ForEach("td", func(col int, el *colly.HTMLElement) {
		switch col {
		case COL_TICKER:
			gilt.Ticker = strings.TrimSpace(el.Text)
			if gilt.Ticker == "" {
				errs = append(errs, fmt.Errorf("empty ticker"))
			}
		case COL_DESC:
			gilt.Desc = strings.TrimSpace(el.Text)
			if gilt.Desc == "" {
				errs = append(errs, fmt.Errorf("empty description"))
			}
		case COL_COUPON:
			s := strings.TrimSuffix(el.Text, "%")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				gilt.Coupon = float64(price)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse coupon '%s': %v", el.Text, err))
			}
		case COL_MATURITY_DATE:
			if ts, err := time.Parse("02-Jan-2006", el.Text); err == nil {
				gilt.MaturityDate = ts
				gilt.MaturityYears = maturityYears(gilt.CaptureDate, gilt.MaturityDate)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse date '%s': %v", el.Text, err))
			}
		case COL_MATURITY_DURATION:
			// ignore
		case COL_PRICE:
			s := strings.TrimPrefix(el.Text, "£")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				gilt.Price = float64(price)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse price '%s': %v", el.Text, err))
			}
		case COL_MATURITY_YIELD:
			s := strings.TrimSuffix(el.Text, "%")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				gilt.MaturityYield = float64(price)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse yield '%s': %v", el.Text, err))
			}
		}
	})

	if len(errs) > 0 {
		return nil, fmt.Errorf("failed to scrape gilt data: %v", errs)
	}

	return &gilt, nil
}

func ScrapeData() []*Gilt {
	data := []*Gilt{}

	c := colly.NewCollector()

	c.OnHTML("#mainbody tr", func(e *colly.HTMLElement) {
		if gilt, err := scrapeGilt(e); err == nil {
			data = append(data, gilt)
		} else {
			fmt.Printf("Error scraping gilt: %v\n", err)
		}
	})

	c.Visit("https://www.dividenddata.co.uk/uk-gilts-prices-yields.py")

	return data
}

func Store(source string, gilts []*Gilt, path string) error {
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	writer := parquet.NewGenericWriter[*Gilt](file)
	defer writer.Close()

	if _, err := writer.Write(gilts); err != nil {
		return fmt.Errorf("failed to write records: %w", err)
	}

	return nil
}

func CollectToS3(ctx context.Context, bucketName string) error {
	data := ScrapeData()
	source := "dividenddata"
	date := time.Now()

	src := "/tmp/data"

	if err := Store("dividenddata", data, src); err != nil {
		return fmt.Errorf("failed to save data to parquet format: %v", err)
	}

	defer os.Remove(src)

	key := fmt.Sprintf(
		"%04d/%02d/%02d/%s.parquet",
		date.UTC().Year(),
		date.UTC().Month(),
		date.UTC().Day(),
		source,
	)

	file, err := os.OpenFile(src, os.O_RDONLY, 0)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	client := s3.NewFromConfig(cfg)

	input := &s3.PutObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(key),
		Body:   file,
	}

	if _, err := client.PutObject(ctx, input); err != nil {
		return fmt.Errorf("failed to upload file to s3://%s/%s: %w", bucketName, key, err)
	}

	return nil
}
