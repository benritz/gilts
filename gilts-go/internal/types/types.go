package types

import (
	"fmt"
	"math"
	"time"
)

type BondType string

var (
	UKGilt BondType = "UK Gilt"
)

type Bond struct {
	Type             BondType
	Source           string
	ISIN             string
	Ticker           string
	Desc             string
	FacePrice        float64
	Coupon           float64
	SettlementDate   time.Time
	PrevCouponDate   time.Time
	NextCouponDate   time.Time
	RemainingDays    int
	AccruedDays      int
	CouponPeriodDays int
	CouponPeriods    int
	MaturityDate     time.Time
	MaturityYears    int
	MaturityDays     int
	CleanPrice       float64
	DirtyPrice       float64
	YieldToMaturity  float64
}

func NewUKGilt(source string, settlementDate time.Time) *Bond {
	return &Bond{
		Type:           UKGilt,
		FacePrice:      100.0,
		Source:         source,
		SettlementDate: settlementDate,
	}
}

func MaturityYears(settlementDate, maturityDate time.Time) (int, int, error) {
	if maturityDate.Before(settlementDate) {
		return 0, 0, ErrMaturityDateBeforeSettlement
	}

	years := int(maturityDate.Year() - settlementDate.Year())

	end := time.Date(
		maturityDate.Year(),
		maturityDate.Month(),
		maturityDate.Day(),
		0,
		0,
		0,
		0,
		maturityDate.Location(),
	)

	start := time.Date(
		maturityDate.Year(),
		settlementDate.Month(),
		settlementDate.Day(),
		0,
		0,
		0,
		0,
		maturityDate.Location(),
	)

	if start.After(end) {
		years--
		start = start.AddDate(-1, 0, 0)
	}

	days := int(end.Sub(start).Hours() / 24)

	return years, days, nil
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
func CleanPrice(C, y, F float64, n, m, tn, tb int) float64 {
	// Calculate the price of a gilt using the formula:
	// Price = (Coupon / (1 + Yield)^1) + (Coupon / (1 + Yield)^2) + ... + (Coupon + 100 / (1 + Yield)^Years)

	CP := C / 100 / float64(n) * F
	ypp := y / 100 / float64(n)

	price := 0.0

	// At maturity, we receive the face value plus possibly a partial coupon
	mp := F

	// If maturity doesn't coincide with a coupon payment date, add partial coupon
	r := float64(tn) / float64(tb)
	if r > 0 {
		mp += CP * r
		m--
	}

	// Add the present value of the maturity payment
	price += mp / math.Pow(1+ypp, float64(m)+r)

	for j := int(1); j <= m; j++ {
		price += CP / math.Pow(1+ypp, float64(j))
	}

	return price
}

func CleanPriceDerivative(C, y, F float64, n, m, tn, tb int) float64 {
	CP := C / 100 / float64(n) * F
	ypp := y / 100 / float64(n)
	dYppDy := 1 / (100 * float64(n))
	r := float64(tn) / float64(tb)

	derivative := 0.0

	// Derivative of the maturity payment part
	mp := F
	mAdj := m
	if r > 0 {
		mp += CP * r
		mAdj--
	}

	term1Numerator := -mp * (float64(mAdj) + r)
	term1Denominator := math.Pow(1+ypp, float64(mAdj)+r+1)
	derivative += term1Numerator / term1Denominator * dYppDy

	// Derivative of the coupon payment parts
	for j := int(1); j <= m; j++ {
		termNumerator := -CP * float64(j)
		termDenominator := math.Pow(1+ypp, float64(j)+1)
		derivative += termNumerator / termDenominator * dYppDy
	}

	return derivative
}

func CleanPriceYieldToMaturity(C, F, P float64, n, m, tn, tb int, y, t float64, i int) (float64, error) {
	for range i {
		p := CleanPrice(C, y, F, n, m, tn, tb)

		dp := p - P
		if math.Abs(dp) < t {
			return y, nil
		}

		d := CleanPriceDerivative(C, y, F, n, m, tn, tb)
		if math.Abs(d) < 1e-12 {
			return 0, ErrYieldToMaturityDerivativeTooSmall
		}

		y = y - dp/d
	}

	return 0, ErrYieldToMaturityNoConvergence
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
func DirtyPrice(C, y, F float64, n, m, tn, tb int) float64 {
	y = y / 100

	sum := 0.0
	for j := int(1); j <= m; j++ {
		sum += (C / float64(n)) / math.Pow(1+(y/float64(n)), float64(j-1))
	}

	r := float64(tn) / float64(tb)

	return (1 / math.Pow(1+(y/float64(n)), r)) * (sum + F/math.Pow(1+(y/float64(n)), float64(m-1)))
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
func DirtyPriceDerivative(C, F, y float64, n, m, tn, tb int) float64 {
	derivative := 0.0
	for j := int(1); j <= m; j++ {
		derivative += -(float64(j-1) * (C / float64(n)) / math.Pow(1+(y/float64(n)), float64(j)) / float64(n))
	}

	sum := 0.0
	for j := int(1); j <= m; j++ {
		sum += (C / float64(n)) / math.Pow(1+(y/float64(n)), float64(j-1))
	}

	r := float64(tn) / float64(tb)

	derivative += -r / (1 + y/float64(n)) * (F/math.Pow(1+y/float64(n), float64(m-1)) + sum)
	derivative += (1 / math.Pow(1+y/float64(n), r)) * (-(float64(m-1) / float64(n)) * F / math.Pow(1+y/float64(n), float64(m)) / float64(n))

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
func DirtyPriceYieldToMaturity(C, F, P float64, n, m, tn, tb int, y, t float64, i int) (float64, error) {
	y = y / 100

	for range i {
		p := DirtyPrice(C, y*100, F, n, m, tn, tb)

		dp := p - P
		if math.Abs(dp) < t {
			return y * 100, nil
		}

		d := DirtyPriceDerivative(C, F, y, n, m, tn, tb)
		if math.Abs(d) < 1e-12 {
			return 0, ErrYieldToMaturityDerivativeTooSmall
		}

		y = y - dp/d
	}

	return 0, ErrYieldToMaturityNoConvergence
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

var (
	ErrNilBond                           = fmt.Errorf("bond is nil")
	ErrMissingSettlementDate             = fmt.Errorf("missing settlement date")
	ErrDataUnavailable                   = fmt.Errorf("data unavailable")
	ErrUnsupportedBond                   = fmt.Errorf("unsupported bond")
	ErrInvalidTicker                     = fmt.Errorf("invalid ticker")
	ErrInvalidCoupon                     = fmt.Errorf("invalid coupon")
	ErrInvalidDesc                       = fmt.Errorf("invalid description")
	ErrInvalidMaturityDate               = fmt.Errorf("invalid maturity date")
	ErrInvalidSettlementDate             = fmt.Errorf("invalid settlement date")
	ErrMaturityDateBeforeSettlement      = fmt.Errorf("maturity date is before settlement date")
	ErrYieldToMaturityNoConvergence      = fmt.Errorf("Newton-Raphson failed to converge within max iterations")
	ErrYieldToMaturityDerivativeTooSmall = fmt.Errorf("Newton-Raphson failed (derivative is too small)")
	ErrInvalidCleanPrice                 = fmt.Errorf("invalid clean price")
	ErrInvalidDirtyPrice                 = fmt.Errorf("invalid dirty price")
	ErrInvalidYieldToMaturity            = fmt.Errorf("invalid yield to maturity")
	ErrInvalidFacePrice                  = fmt.Errorf("invalid face price")
	ErrMissingPriceAndYield              = fmt.Errorf("missing price and yield")
)

func CompleteBond(b *Bond) error {
	if b == nil {
		return ErrNilBond
	}

	if b.SettlementDate.IsZero() {
		return ErrInvalidSettlementDate
	}

	if b.MaturityDate.IsZero() {
		return ErrInvalidMaturityDate
	}

	if b.Coupon <= 0 {
		return ErrInvalidCoupon
	}

	if b.FacePrice <= 0 {
		return ErrInvalidFacePrice
	}

	if b.CleanPrice < 0 {
		return ErrInvalidCleanPrice
	}

	if b.DirtyPrice < 0 {
		return ErrInvalidDirtyPrice
	}

	if b.YieldToMaturity < 0 {
		return ErrInvalidYieldToMaturity
	}

	// requires either a price or yield to maturity to calulate the other
	if b.CleanPrice == 0 && b.DirtyPrice == 0 && b.YieldToMaturity == 0 {
		return ErrMissingPriceAndYield
	}

	years, days, err := MaturityYears(b.SettlementDate, b.MaturityDate)
	if err != nil {
		return err
	}

	b.MaturityYears = years
	b.MaturityDays = days

	if b.NextCouponDate.IsZero() {
		t := time.Date(
			b.SettlementDate.Year(),
			b.MaturityDate.Month(),
			b.MaturityDate.Day(),
			0,
			0,
			0,
			0,
			b.MaturityDate.Location(),
		)

		if b.SettlementDate.After(t) {
			t = t.AddDate(0, 6, 0)
		} else {
			t2 := t.AddDate(0, -6, 0)
			if b.SettlementDate.Before(t2) {
				t = t2
			}
		}

		b.NextCouponDate = t
	}

	if b.PrevCouponDate.IsZero() {
		b.PrevCouponDate = b.NextCouponDate.AddDate(0, -6, 0)
	}

	b.RemainingDays = int(math.Floor(b.NextCouponDate.Sub(b.SettlementDate).Hours() / 24))
	b.AccruedDays = int(math.Floor(b.SettlementDate.Sub(b.PrevCouponDate).Hours() / 24))
	b.CouponPeriodDays = int(math.Floor(b.NextCouponDate.Sub(b.PrevCouponDate).Hours() / 24))

	// TODO need to account for different day-count conventions 360/30 vs Actual/Actual
	b.CouponPeriods = (int(b.MaturityYears) * 2) + int(math.Ceil(float64(b.MaturityDays)/365.0*2))

	if b.YieldToMaturity == 0 {
		estimatedYTM := EstimatedYieldToMaturity(
			b.Coupon,
			b.FacePrice,
			b.CleanPrice,
			float64(b.MaturityYears)+float64(b.MaturityDays)/365.0,
		)

		var (
			ytm float64
			err error
		)

		if b.DirtyPrice > 0 {
			ytm, err = DirtyPriceYieldToMaturity(
				b.Coupon,
				b.FacePrice,
				b.DirtyPrice,
				2,
				b.CouponPeriods,
				b.RemainingDays,
				b.CouponPeriodDays,
				estimatedYTM,
				0.001,
				1_000,
			)
		} else {
			ytm, err = CleanPriceYieldToMaturity(
				b.Coupon,
				b.FacePrice,
				b.CleanPrice,
				2,
				b.CouponPeriods,
				b.RemainingDays,
				b.CouponPeriodDays,
				estimatedYTM,
				0.001,
				1_000,
			)
		}

		if err != nil {
			return err
		}

		b.YieldToMaturity = ytm
	}

	if b.CleanPrice == 0 && b.DirtyPrice == 0 {
		b.DirtyPrice = DirtyPrice(
			b.Coupon,
			b.YieldToMaturity,
			b.FacePrice,
			2,
			b.CouponPeriods,
			b.RemainingDays,
			b.CouponPeriodDays,
		)
	}

	accruedAmount := float64(b.AccruedDays) / float64(b.CouponPeriodDays) * b.Coupon / 2 / 100 * b.FacePrice

	if b.CleanPrice == 0 {
		b.CleanPrice = b.DirtyPrice - accruedAmount
	} else if b.DirtyPrice == 0 {
		b.DirtyPrice = b.CleanPrice + accruedAmount
	}

	return nil
}
