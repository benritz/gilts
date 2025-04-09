package main

import (
	"benritz/gilts/internal/types"
	"fmt"
)

func main() {
	var ytm, ey float64
	var err error

	// 3 1/2% Treasury Gilt 2025
	fmt.Println("3 1/2% Treasury Gilt 2025")
	ey = types.EstimatedYieldToMaturity(3.5, 100, 99.60, 0.0+(197.0/365.0))
	fmt.Printf("Estimated YTM: %.8f\n", ey)
	ytm, err = types.CleanPriceYieldToMaturity(3.5, 100, 99.60, 2, 2, 13, 182, ey, 0.001, 1_000)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("Clean YTM: %.8f\n", ytm)
	}
	ytm, err = types.DirtyPriceYieldToMaturity(3.5, 100, 101.22, 2, 2, 13, 182, ey, 0.001, 1_000)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("Dirty YTM: %.8f\n", ytm)
	}
	fmt.Println()
}
