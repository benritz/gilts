package main

import (
	"benritz/gilts/internal/types"
	"fmt"

	_ "github.com/pbnjay/grate/xls"
)

func main() {
	var y, ey, price float64
	var err2 error

	// TG25 0 5/8% Treasury Gilt 2025
	fmt.Println("TG25 0 5/8% Treasury Gilt 2025")
	ey = types.EstimatedYieldToMaturity(0.625, 100, 99.28, 0.0+(79.0/365.0))
	fmt.Printf("Estimated YTM: %.8f\n", ey)
	y, err2 = types.CleanPriceYieldToMaturity(0.625, 100, 99.28, 2, 1, 79, 182, ey, 0.001, 1_000)
	if err2 != nil {
		fmt.Printf("Error: %v\n", err2)
	} else {
		fmt.Printf("Clean YTM: %.8f\n", y)
	}
	y, err2 = types.DirtyPriceYieldToMaturity(0.625, 100, 99.45, 2, 1, 79, 182, ey, 0.001, 1_000)
	if err2 != nil {
		fmt.Printf("Error: %v\n", err2)
	} else {
		fmt.Printf("Dirty YTM: %.8f\n", y)
	}
	fmt.Println()

	// TS28	4 1/2% Treasury Gilt 2028
	fmt.Println("TS28 4 1/2% Treasury Gilt 2028")
	ey = types.EstimatedYieldToMaturity(4.5, 100, 100.9, 3.0+(81.0/365.0))
	fmt.Printf("Estimated YTM: %.8f\n", ey)
	y, err2 = types.CleanPriceYieldToMaturity(4.5, 100, 100.9, 2, 7, 80, 182, ey, 0.001, 1_000)
	if err2 != nil {
		fmt.Printf("Error: %v\n", err2)
	} else {
		fmt.Printf("Clean YTM: %.8f\n", y)
	}
	y, err2 = types.DirtyPriceYieldToMaturity(4.5, 100, 102.16, 2, 7, 80, 182, ey, 0.001, 1_000)
	if err2 != nil {
		fmt.Printf("Error: %v\n", err2)
	} else {
		fmt.Printf("Dirty YTM: %.8f\n", y)
	}
	fmt.Println()

	// T25	2% Treasury Gilt 2025
	fmt.Println("T25 2% Treasury Gilt 2025")
	ey = types.EstimatedYieldToMaturity(2, 100, 99.0, 0.0+(172.0/365.0))
	fmt.Printf("Estimated YTM: %.8f\n", ey)
	y, err2 = types.DirtyPriceYieldToMaturity(2, 100, 99.06, 2, 1, 172, 183, ey, 0.001, 1_000)
	if err2 != nil {
		fmt.Printf("Error: %v\n", err2)
	} else {
		fmt.Printf("Dirty YTM: %.8f\n", y)
	}
	y, err2 = types.CleanPriceYieldToMaturity(2, 100, 99.00, 2, 1, 172, 183, ey, 0.001, 1_000)
	if err2 != nil {
		fmt.Printf("Error: %v\n", err2)
	} else {
		fmt.Printf("Clean YTM: %.8f\n", y)
	}
	fmt.Println()

	// T35 4 1/2% Treasury Gilt 2035
	fmt.Println("T35 4 1/2% Treasury Gilt 2035")
	price = types.DirtyPrice(4.5, 4.626, 100, 2, 20, 172, 183)
	fmt.Printf("Dirty Price: %.3f\n", price)
	price = types.CleanPrice(4.5, 4.626, 100, 2, 20, 172, 183)
	fmt.Printf("Clean Price: %.3f\n", price)
	ey = types.EstimatedYieldToMaturity(4.5, 100, 99.0, 9.0+(355.0/365.0))
	fmt.Printf("Estimated YTM: %.8f\n", ey)
	y, err2 = types.DirtyPriceYieldToMaturity(4.5, 100, 99.14, 2, 20, 172, 183, ey, 0.001, 1_000)
	if err2 != nil {
		fmt.Printf("Error: %v\n", err2)
	} else {
		fmt.Printf("Dirty YTM: %.8f\n", y)
	}
}
