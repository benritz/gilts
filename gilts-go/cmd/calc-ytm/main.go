package main

import (
	"benritz/gilts/internal/types"
	"flag"
	"fmt"
	"time"
)

func parseDate(s *string) (time.Time, error) {
	if s == nil || *s == "" {
		return time.Now(), nil
	}
	ts, err := time.Parse("2006-01-02", *s)
	if err == nil {
		return ts, nil
	}
	return time.Time{}, err
}

func main() {
	coupon := flag.Float64("coupon", 0.0, "Coupon rate (%) of the bond")
	faceValue := flag.Float64("facevalue", 100, "Face value of the bond")
	cleanPrice := flag.Float64("cleanprice", 0.0, "Clean price of the bond")
	ytm := flag.Float64("ytm", 0.0, "Yield to maturity of the bond")
	settlementDateStr := flag.String("settlementdate", "", "Settlement date of the bond (YYYY-MM-DD)")
	maturityDateStr := flag.String("maturitydate", "", "Maturity date of the bond (YYYY-MM-DD)")

	flag.Parse()

	flagsSet := make(map[string]bool)
	flag.Visit(func(f *flag.Flag) {
		flagsSet[f.Name] = true
	})

	if !flagsSet["coupon"] {
		fmt.Println("Error: -coupon flag is required")
		return
	}

	if !flagsSet["cleanprice"] && !flagsSet["ytm"] {
		fmt.Println("Error: -cleanprice or -ytm flag is required")
		return
	}

	if !flagsSet["maturitydate"] || maturityDateStr == nil || *maturityDateStr == "" {
		fmt.Println("Error: -maturitydate flag is required")
		return
	}

	settlementDate, err := parseDate(settlementDateStr)
	if err != nil {
		fmt.Printf("Error: invalid settlement date: %v\n", err)
		return
	}

	maturityDate, err := parseDate(maturityDateStr)
	if err != nil {
		fmt.Printf("Error: invalid maturity date: %v\n", err)
		return
	}

	if maturityDate.Before(settlementDate) {
		fmt.Println("Error: maturity date cannot be before settlement date")
		return
	}

	if *coupon < 0.0 || *coupon > 100.0 {
		fmt.Println("Error: coupon rate must be between 0.0 and 100.0")
		return
	}

	if *faceValue <= 0.0 {
		fmt.Println("Error: face value must be greater than 0.0")
		return
	}

	if *cleanPrice < 0.0 {
		fmt.Println("Error: clean price must be greater than or equal to 0.0")
		return
	}

	if *ytm < 0.0 {
		fmt.Println("Error: yield to maturity must be greater than or equal to 0.0")
		return
	}

	bond := types.Bond{
		Type:            types.UKGilt,
		FacePrice:       *faceValue,
		Coupon:          *coupon,
		SettlementDate:  settlementDate,
		MaturityDate:    maturityDate,
		CleanPrice:      *cleanPrice,
		YieldToMaturity: *ytm,
	}

	if err := types.CompleteBond(&bond); err != nil {
		fmt.Printf("Error completing bond: %v\n", err)
		return
	}

	fmt.Printf("Bond Details:\n")
	fmt.Printf("\tType: %s\n", bond.Type)
	fmt.Printf("\tFace Value: %.3f\n", bond.FacePrice)
	fmt.Printf("\tCoupon Rate: %.3f%%\n", bond.Coupon)
	fmt.Printf("\tSettlement Date: %s\n", bond.SettlementDate.Format("2006-01-02"))
	fmt.Printf("\tMaturity Date: %s\n", bond.MaturityDate.Format("2006-01-02"))
	fmt.Printf("\tClean Price: %.3f\n", bond.CleanPrice)
	fmt.Printf("\tDirty Price: %.3f\n", bond.DirtyPrice)
	fmt.Printf("\tRemaining Days: %d\n", bond.RemainingDays)
	fmt.Printf("\tAccrued Days: %d\n", bond.AccruedDays)
	fmt.Printf("\tAccrued Amount: %.3f\n", bond.AccruedAmount)
	fmt.Printf("\tCoupon Period Days: %d\n", bond.CouponPeriodDays)
	fmt.Printf("\tCoupon Periods: %d\n", bond.CouponPeriods)
	fmt.Printf("\tNext Coupon Date: %s\n", bond.NextCouponDate.Format("2006-01-02"))
	fmt.Printf("\tPrevious Coupon Date: %s\n", bond.PrevCouponDate.Format("2006-01-02"))
	fmt.Printf("\tMaturity Years: %d\n", bond.MaturityYears)
	fmt.Printf("\tMaturity Days: %d\n", bond.MaturityDays)
	fmt.Printf("\tYield to Maturity: %.6f%%\n", bond.YieldToMaturity)
}
