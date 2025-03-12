package collect

import (
	"benritz/gilts/internal/types"
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/gocolly/colly/v2"
)

var (
	SourceDividendData = "DividendData"
)

type DividendDataCollector struct {
}

func NewDividendDataCollector() *DividendDataCollector {
	return &DividendDataCollector{}
}

func (c *DividendDataCollector) Collect(ctx context.Context, date time.Time) (*CollectedBonds, error) {
	x := colly.NewCollector()

	// check page date matches requested date
	// the page is updated daily, but the data may not be available yet
	DATE_PREFIX := "Last updated: "
	var dataTs time.Time

	x.OnHTML("label", func(e *colly.HTMLElement) {
		if strings.HasPrefix(e.Text, DATE_PREFIX) {
			s := strings.TrimPrefix(e.Text, DATE_PREFIX)
			dataTs, _ = time.Parse("02 Jan 2006", s)
		}
	})

	collected := NewCollectedBonds(SourceDividendData, date)

	x.OnHTML("#mainbody tr", func(e *colly.HTMLElement) {
		cb := c.readBond(e)
		if cb != nil {
			collected.AddBond(cb)
		}
	})

	x.Visit("https://www.dividenddata.co.uk/uk-gilts-prices-yields.py")

	if dataTs.IsZero() {
		return nil, types.ErrMissingSettlementDate
	}

	if !dataTs.Equal(date.Truncate(24 * time.Hour)) {
		return nil, types.ErrDataUnavailable
	}

	return collected, nil
}

func (d *DividendDataCollector) Source() string {
	return SourceDividendData
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

func (c *DividendDataCollector) readBond(e *colly.HTMLElement) *CollectedBond {
	b := types.NewUKGilt(SourceDividendData, time.Now())

	cb := &CollectedBond{Bond: b}

	e.ForEach("td", func(col int, el *colly.HTMLElement) {
		switch col {
		case DD_COL_TICKER:
			b.Ticker = strings.TrimSpace(el.Text)
			if b.Ticker == "" {
				cb.SetError(types.ErrInvalidCoupon)
			}
		case DD_COL_DESC:
			b.Desc = strings.TrimSpace(el.Text)
			if b.Desc == "" {
				cb.SetError(types.ErrInvalidDesc)
			}
		case DD_COL_COUPON:
			s := strings.TrimSuffix(el.Text, "%")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				b.Coupon = float64(price)
			} else {
				cb.SetError(types.ErrInvalidCoupon)
			}
		case DD_COL_MATURITY_DATE:
			if ts, err := time.Parse("02-Jan-2006", el.Text); err == nil {
				b.MaturityDate = ts
			} else {
				cb.SetError(types.ErrInvalidMaturityDate)
			}
		case DD_COL_MATURITY_DURATION:
			// ignore, calculated from maturity date
		case DD_COL_PRICE:
			s := strings.TrimPrefix(el.Text, "£")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				b.CleanPrice = float64(price)
			} else {
				cb.SetError(types.ErrInvalidCleanPrice)
			}
		case DD_COL_MATURITY_YIELD:
			s := strings.TrimSuffix(el.Text, "%")
			if price, err := strconv.ParseFloat(s, 32); err == nil {
				b.YieldToMaturity = float64(price)
			} else {
				cb.SetError(types.ErrInvalidYieldToMaturity)
			}
		}
	})

	return cb
}
