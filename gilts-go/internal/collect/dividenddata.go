package collect

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gocolly/colly/v2"
)

type DividendDataCollector struct {
}

func NewDividendDataCollector() *DividendDataCollector {
	return &DividendDataCollector{}
}

func (c *DividendDataCollector) Collect(ctx context.Context) ([]*Gilt, error) {
	data := []*Gilt{}

	x := colly.NewCollector()

	x.OnHTML("#mainbody tr", func(e *colly.HTMLElement) {
		if gilt, err := c.scrapeGilt(e); err == nil {
			data = append(data, gilt)
		} else {
			// TODO handle parse errors
			fmt.Printf("failed to parse gilt: %v\n", err)
		}
	})

	x.Visit("https://www.dividenddata.co.uk/uk-gilts-prices-yields.py")

	return data, nil
}

func (d *DividendDataCollector) Source() string {
	return "DividendData"
}

var (
	DD_COL_TICKER            = 0
	DD_COL_DESC              = 1
	DD_COL_COUPON            = 2
	DD_COL_MATURITY_DATE     = 3
	DD_COL_MATURITY_DURATION = 4
	DD_COL_PRICE             = 5
	DD_COL_MATURITY_YIELD    = 6
)

func (c *DividendDataCollector) scrapeGilt(e *colly.HTMLElement) (*Gilt, error) {
	gilt := Gilt{CaptureDate: time.Now()}
	errs := []error{}

	e.ForEach("td", func(col int, el *colly.HTMLElement) {
		switch col {
		case DD_COL_TICKER:
			gilt.Ticker = strings.TrimSpace(el.Text)
			if gilt.Ticker == "" {
				errs = append(errs, fmt.Errorf("empty ticker"))
			}
		case DD_COL_DESC:
			gilt.Desc = strings.TrimSpace(el.Text)
			if gilt.Desc == "" {
				errs = append(errs, fmt.Errorf("empty description"))
			}
		case DD_COL_COUPON:
			s := strings.TrimSuffix(el.Text, "%")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				gilt.Coupon = float64(price)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse coupon '%s': %v", el.Text, err))
			}
		case DD_COL_MATURITY_DATE:
			if ts, err := time.Parse("02-Jan-2006", el.Text); err == nil {
				gilt.MaturityDate = ts
				gilt.MaturityYears = MaturityYears(gilt.CaptureDate, gilt.MaturityDate)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse date '%s': %v", el.Text, err))
			}
		case DD_COL_MATURITY_DURATION:
			// ignore
		case DD_COL_PRICE:
			s := strings.TrimPrefix(el.Text, "£")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				gilt.CleanPrice = float64(price)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse price '%s': %v", el.Text, err))
			}
		case DD_COL_MATURITY_YIELD:
			s := strings.TrimSuffix(el.Text, "%")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				gilt.MaturityYield = float64(price)
			} else {
				errs = append(errs, fmt.Errorf("failed to parse yield '%s': %v", el.Text, err))
			}
		}
	})

	if len(errs) > 0 {
		return nil, fmt.Errorf("failed to parse gilt data: %v", errs)
	}

	return &gilt, nil
}
