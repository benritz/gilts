package collect

import (
	"benritz/gilts/internal/types"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pbnjay/grate"
)

var SourceDMO = "DMO"

type DMOCollector struct {
}

func NewDMOCollector() *DMOCollector {
	return &DMOCollector{}
}

func (c *DMOCollector) Collect(ctx context.Context, date time.Time) (*CollectedBonds, error) {
	// The DMO website has a number of reports that can be used to collect gilt data.
	// https://www.dmo.gov.uk/data/pdfdatareport?reportCode=D1A
	// https://www.dmo.gov.uk/data/pdfdatareport?reportCode=D9D
	// https://www.dmo.gov.uk/data/pdfdatareport?reportCode=D10B

	params := fmt.Sprintf("&Trade Date=%02d-%02d-%04d", date.Day(), date.Month(), date.Year())
	url := "https://www.dmo.gov.uk/umbraco/surface/DataExport/GetDataExport?reportCode=D10B&exportFormatValue=xls&parameters=" + url.QueryEscape(params)

	fmt.Printf("Fetching %s\n", url)

	client := &http.Client{}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get data: http %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "gilt-*.xls")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())

	size, err := io.Copy(tmp, resp.Body)
	tmp.Close()
	if err != nil {
		return nil, err
	}

	fmt.Printf("Downloaded %d bytes to %s\n", size, tmp.Name())

	stat, err := os.Stat(tmp.Name())
	if err != nil {
		return nil, err
	}

	fmt.Printf("File %s size: %d bytes\n", stat.Name(), stat.Size())

	wb, err := grate.Open(tmp.Name())
	if err != nil {
		return nil, err
	}
	defer wb.Close()

	collected := NewCollectedBonds(SourceDMO, date)
	parsed := 0

	sheets, err := wb.List()
	if err != nil {
		return nil, err
	}
	for _, sheetName := range sheets {
		sheet, err := wb.Get(sheetName)

		if err != nil {
			return nil, err
		}

		for sheet.Next() {
			row := sheet.Strings()
			c, err := c.parseRow(date, row)
			if err == nil {
				collected.AddBond(c)
				parsed++
			}
		}
	}

	if parsed == 0 {
		return nil, types.ErrDataUnavailable
	}

	return collected, nil
}

func (d *DMOCollector) Source() string {
	return SourceDMO
}

func (c *DMOCollector) parseRow(date time.Time, row []string) (*CollectedBond, error) {
	if len(row) == 0 {
		return nil, ErrInvaidRow
	}

	isin := row[0]

	if !strings.HasPrefix(isin, "GB") {
		return nil, ErrInvaidRow
	}

	b := types.NewUKGilt(SourceDMO, date)
	b.ISIN = strings.TrimSpace(isin)
	b.Desc = strings.TrimSpace(row[1])

	// unsupported bonds
	if strings.Contains(strings.ToLower(b.Desc), "index-linked") {
		return nil, types.ErrUnsupportedBond
	}

	cb := &CollectedBond{Bond: b}

	if coupon, err := parseCouponPercentage(b.Desc); err == nil {
		b.Coupon = coupon
	} else {
		cb.SetError(types.ErrInvalidCoupon)
	}

	if cleanPrice, err := strconv.ParseFloat(strings.TrimSpace(row[2]), 32); err == nil {
		b.CleanPrice = float64(cleanPrice)
	} else {
		cb.SetError(types.ErrInvalidCleanPrice)
	}

	if dirtyPrice, err := strconv.ParseFloat(strings.TrimSpace(row[3]), 32); err == nil {
		b.DirtyPrice = float64(dirtyPrice)
	} else {
		cb.SetError(types.ErrInvalidDirtyPrice)
	}

	if ts, err := time.Parse("02-Jan-2006", strings.TrimSpace(row[7])); err == nil {
		b.MaturityDate = ts
	} else {
		cb.SetError(types.ErrInvalidMaturityDate)
	}

	if cb.Err == nil {
		cb.Err = types.CompleteBond(b)
	}

	return cb, nil
}

// parseCouponPercentage parses a coupon percentage string it the following formats
// 0 5/8% Treasury Gilt 2025,
// 2% Treasury Gilt 2025,
// 3½% Treasury Gilt 2025
//
//	s: bond description
//
// Returns:
//
//	Coupon percentage
func parseCouponPercentage(desc string) (float64, error) {
	re := regexp.MustCompile(`^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|\d+|\d[¼½¾])(%)`)
	match := re.FindStringSubmatch(desc)

	if len(match) < 3 {
		return 0, types.ErrInvalidCoupon
	}

	m := match[1]

	// convert ½, ¼, ¾ suffixes
	trimLast := func(s string) string {
		r := []rune(s)
		return string(r[0 : len(r)-1])
	}
	if strings.HasSuffix(m, "½") {
		m = trimLast(m) + " 1/2"
	} else if strings.HasSuffix(m, "¼") {
		m = trimLast(m) + " 1/4"
	} else if strings.HasSuffix(m, "¾") {
		m = trimLast(m) + " 3/4"
	}

	if strings.Contains(m, "/") {
		parts := strings.Split(m, " ")
		if len(parts) == 2 {
			// Mixed number
			whole, err := strconv.Atoi(parts[0])
			if err != nil {
				return 0, types.ErrInvalidCoupon
			}
			fractionParts := strings.Split(parts[1], "/")
			if len(fractionParts) != 2 {
				return 0, types.ErrInvalidCoupon
			}
			num, err := strconv.Atoi(fractionParts[0])
			if err != nil {
				return 0, types.ErrInvalidCoupon
			}
			den, err := strconv.Atoi(fractionParts[1])
			if err != nil {
				return 0, types.ErrInvalidCoupon
			}
			if den == 0 {
				return 0, types.ErrInvalidCoupon
			}
			return float64(whole) + float64(num)/float64(den), nil
		} else if len(parts) == 1 {
			// Fraction only
			fractionParts := strings.Split(parts[0], "/")
			if len(fractionParts) != 2 {
				return 0, types.ErrInvalidCoupon
			}
			num, err := strconv.Atoi(fractionParts[0])
			if err != nil {
				return 0, types.ErrInvalidCoupon
			}
			den, err := strconv.Atoi(fractionParts[1])
			if err != nil {
				return 0, types.ErrInvalidCoupon
			}
			if den == 0 {
				return 0, types.ErrInvalidCoupon
			}
			return float64(num) / float64(den), nil
		}
	} else {
		// Whole number
		val, err := strconv.ParseFloat(m, 64)
		if err != nil {
			return 0, types.ErrInvalidCoupon
		}
		return val, nil
	}

	return 0, types.ErrInvalidCoupon
}
