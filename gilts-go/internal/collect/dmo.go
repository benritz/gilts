package collect

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/pbnjay/grate"
)

type DMOCollector struct {
}

func NewDMOCollector() *DMOCollector {
	return &DMOCollector{}
}

func (c *DMOCollector) Collect(ctx context.Context) ([]*Gilt, error) {
	now := time.Now().Add(-72 * time.Hour)

	params := fmt.Sprintf("&Trade Date=%02d-%02d-%04d", now.Day(), now.Month(), now.Year())
	url := "https://www.dmo.gov.uk/umbraco/surface/DataExport/GetDataExport?reportCode=D10B&exportFormatValue=xls&parameters=" + url.QueryEscape(params)

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

	fmt.Printf("Downloaded %d bytes\n", size)

	wb, err := grate.Open(tmp.Name())
	if err != nil {
		return nil, err
	}

	data := []*Gilt{}

	sheets, _ := wb.List()
	for _, sheetName := range sheets {
		sheet, _ := wb.Get(sheetName)
		for sheet.Next() {
			row := sheet.Strings()
			gilt, _ := c.parseRow(row)
			if gilt != nil {
				data = append(data, gilt)
			}
		}
	}
	wb.Close()

	fmt.Printf("Parsed %d rows\n", len(data))
	for _, gilt := range data {
		fmt.Printf("Gilt: %v\n", *gilt)
	}

	return data, nil
}

func (d *DMOCollector) Source() string {
	return "DMO"
}

func (c *DMOCollector) parseRow(row []string) (*Gilt, error) {
	if len(row) == 0 {
		return nil, nil
	}

	isin := row[0]

	if !strings.HasPrefix(isin, "GB") {
		return nil, nil
	}

	gilt := &Gilt{}
	errs := []error{}

	gilt.Source = "DMO"
	gilt.CaptureDate = time.Now()
	gilt.ISIN = strings.TrimSpace(isin)
	gilt.Desc = strings.TrimSpace(row[1])

	cell := strings.TrimSpace(row[2])
	if price, err := strconv.ParseFloat(cell, 32); err == nil {
		gilt.CleanPrice = float64(price)
	} else {
		errs = append(errs, fmt.Errorf("failed to parse price '%s': %v", cell, err))
	}

	cell = strings.TrimSpace(row[3])
	if price, err := strconv.ParseFloat(cell, 32); err == nil {
		gilt.DirtyPrice = float64(price)
	} else {
		errs = append(errs, fmt.Errorf("failed to parse price '%s': %v", cell, err))
	}

	cell = strings.TrimSpace(row[7])
	if ts, err := time.Parse("02-Jan-2006", cell); err == nil {
		gilt.MaturityDate = ts
		gilt.MaturityYears = MaturityYears(gilt.CaptureDate, gilt.MaturityDate)
	} else {
		errs = append(errs, fmt.Errorf("failed to parse date '%s': %v", cell, err))
	}

	if len(errs) > 0 {
		return nil, fmt.Errorf("failed to parse gilt data: %v", errs)
	}

	return gilt, nil
}
