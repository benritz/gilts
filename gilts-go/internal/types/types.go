package types

import (
	"fmt"
	"math"
	"time"
)

type Gilt struct {
	Source        string
	CaptureDate   time.Time
	ISIN          string
	Ticker        string
	Desc          string
	Coupon        float64
	CleanPrice    float64
	DirtyPrice    float64
	MaturityDate  time.Time
	MaturityYears float64
	MaturityYield float64
}

func MaturityYears(capture, maturity time.Time) float64 {
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

// CleanPrice calculates the bond price when cash flows occur at unequal intervals.
//
// Parameters:
//
//	C:    Annual coupon rate (as a percentage).
//	y:    Annual yield to maturity (as a percentage).
//	F:    Face value of the bond.
//	n:    The number of coupon payments per year.
//	m:    The number of coupon payouts remaining to maturity.
//	tn:   The number of days from the settlement date to the next coupon payment.
//	tb:   The number of days between the last coupon date and the next coupon date.
//
// Returns:
//
//	Clean bond price.
func CleanPrice(C, y, F float64, n, m int, tn, tb float64) float64 {
	// Calculate the price of a gilt using the formula:
	// Price = (Coupon / (1 + Yield)^1) + (Coupon / (1 + Yield)^2) + ... + (Coupon + 100 / (1 + Yield)^Years)

	CP := C / 100 / float64(n) * F
	ypp := y / 100 / float64(n)

	price := 0.0

	// At maturity, we receive the face value plus possibly a partial coupon
	mp := F

	// If maturity doesn't coincide with a coupon payment date, add partial coupon
	pr := tn / tb
	if pr > 0 {
		mp += CP * pr
		m--
	}

	// Add the present value of the maturity payment
	price += mp / math.Pow(1+ypp, float64(m)+pr)

	for j := 1; j <= m; j++ {
		price += CP / math.Pow(1+ypp, float64(j))
	}

	return price
}

func CleanPriceDerivative(C, y, F float64, n, m int, tn, tb float64) float64 {
	CP := C / 100 / float64(n) * F
	ypp := y / 100 / float64(n)
	dYppDy := 1 / (100 * float64(n))
	pr := tn / tb

	derivative := 0.0

	// Derivative of the maturity payment part
	mp := F
	mAdj := m
	if pr > 0 {
		mp += CP * pr
		mAdj--
	}

	term1Numerator := -mp * (float64(mAdj) + pr)
	term1Denominator := math.Pow(1+ypp, float64(mAdj)+pr+1)
	derivative += term1Numerator / term1Denominator * dYppDy

	// Derivative of the coupon payment parts
	for j := 1; j <= m; j++ {
		termNumerator := -CP * float64(j)
		termDenominator := math.Pow(1+ypp, float64(j)+1)
		derivative += termNumerator / termDenominator * dYppDy
	}

	return derivative
}

var (
	ErrNoConvergence      = fmt.Errorf("Newton-Raphson failed to converge within max iterations")
	ErrDerivativeTooSmall = fmt.Errorf("Newton-Raphson failed (derivative is too small)")
)

func CleanPriceYieldToMaturity(C, F, P float64, n, m int, tn, tb, y, t float64, i int) (float64, error) {
	// y = y / 100

	for range i {
		p := CleanPrice(C, y, F, n, m, tn, tb)

		dp := p - P
		if math.Abs(dp) < t {
			return y, nil
		}

		d := CleanPriceDerivative(C, y, F, n, m, tn, tb)
		if math.Abs(d) < 1e-12 {
			return 0, ErrDerivativeTooSmall
		}

		y = y - dp/d
	}

	return 0, ErrNoConvergence
}

// DirtyPrice calculates the bond price when cash flows occur at unequal intervals.
//
// Parameters:
//
//	C:    Annual coupon rate (as a percentage).
//	y:    Annual yield to maturity (as a percentage).
//	F:    Face value of the bond.
//	n:    The number of coupon payments per year.
//	m:    The number of coupon payouts remaining to maturity.
//	tn:   The number of days from the settlement date to the next coupon payment.
//	tb:   The number of days between the last coupon date and the next coupon date.
//
// Returns:
//
//	Dirty bond price.
func DirtyPrice(C, y, F float64, n, m int, tn, tb float64) float64 {
	y = y / 100

	sum := 0.0
	for j := 1; j <= m; j++ {
		sum += (C / float64(n)) / math.Pow(1+(y/float64(n)), float64(j-1))
	}

	p := tn / tb

	return (1 / math.Pow(1+(y/float64(n)), p)) * (sum + F/math.Pow(1+(y/float64(n)), float64(m-1)))
}

// DirtyPriceDerivative calculates the derivative of the bond price function with respect to yield for unequal intervals.
// This is used in the Newton-Raphson method.
//
// Parameters:
//
//	C:    Annual coupon rate.
//	F:    Face value of the bond.
//	y:    Yield to maturity.
//	m:    The number of coupon payouts remaining to maturity.
//	tn:   The number of days from the settlement date to the next coupon payment.
//	tb:   The number of days between the last coupon date and the next coupon date.
//
// Returns:
//
//	The derivative of the bond price function.
func DirtyPriceDerivative(C, F, y float64, n, m int, tn, tb float64) float64 {
	derivative := 0.0
	for j := 1; j <= m; j++ {
		derivative += -(float64(j-1) * (C / float64(n)) / math.Pow(1+(y/float64(n)), float64(j)) / float64(n))
	}

	sum := 0.0
	for j := 1; j <= m; j++ {
		sum += (C / float64(n)) / math.Pow(1+(y/float64(n)), float64(j-1))
	}

	derivative += -(tn / tb) / (1 + y/float64(n)) * (F/math.Pow(1+y/float64(n), float64(m-1)) + sum)
	derivative += (1 / math.Pow(1+y/float64(n), tn/tb)) * (-(float64(m-1) / float64(n)) * F / math.Pow(1+y/float64(n), float64(m)) / float64(n))

	return derivative
}

// DirtyPriceYieldToMaturity calculates the yield to maturity using the Newton-Raphson numerical method
// for bonds with unequal intervals between cash flows.
//
// Parameters:
//
//	C:		Annual coupon rate.
//	F:		Face value of the bond.
//	P:		Dirty price.
//	n:		The number of coupon payments per year.
//	m:		The number of coupon payouts remaining to maturity.
//	tn:		The number of days from the settlement date to the next coupon payment.
//	tb:		The number of days between the last coupon date and the next coupon date.
//	y:		Estimated yield to maturity (initial guess).
//	t:		Tolerance level for convergence.
//	i:		Maximum number of iterations.
//
// Returns:
//
//	Yield to maturity as a percentage.
func DirtyPriceYieldToMaturity(C, F, P float64, n, m int, tn, tb, y, t float64, i int) (float64, error) {
	y = y / 100

	for range i {
		p := DirtyPrice(C, y*100, F, n, m, tn, tb)

		dp := p - P
		if math.Abs(dp) < t {
			return y * 100, nil
		}

		d := DirtyPriceDerivative(C, F, y, n, m, tn, tb)
		if math.Abs(d) < 1e-12 {
			return 0, ErrDerivativeTooSmall
		}

		y = y - dp/d
	}

	return 0, ErrNoConvergence
}

// EstimatedYieldToMaturity calculates a rough estimate of the yield to maturity used as a starting
// point for numerical methods to calculate a more accurate YTM.
//
//	C: Annual coupon rate.
//	F: Face value of the bond.
//	P: Market price of the bond.
//	n: Number of years to maturity.
//
// Returns:
//
//	Estimated yield to maturity as a percentage.
func EstimatedYieldToMaturity(C, F, P, n float64) float64 {
	CP := C / 100 * F
	y := (CP + (F-P)/n) / ((F + P) / 2)
	return y * 100
}
