export type MaturityRange = number | "max" | undefined

function getOption(name: string, defaultValue?: string): string | undefined {
  return localStorage.getItem(name) ?? defaultValue
}

function setOption(name: string, value?: string): void {
  if (value === undefined || value === '') {
    localStorage.removeItem(name)
    return
  }
  localStorage.setItem(name, value)
}

export function chartTooltipOption(): boolean {
  return getOption('chartTooltip', '1') === '1'
}

export function setChartTooltipOption(enabled: boolean): void {
  setOption('chartTooltip', enabled ? undefined : '0')
}

export function followOnHoverOption(): boolean {
  return getOption('followOnHover', '1') === '1'
}

export function setFollowOnHoverOption(enabled: boolean): void {
  setOption('followOnHover', enabled ? undefined : '0')
}

export function maturityRangeOption(): MaturityRange {
  const value = getOption('maturityRange')

  if (value === undefined) {
    return undefined
  }

  if (value === 'max') {
    return 'max'
  }

  return Number(value)
}

export function setMaturityRangeOption(years: MaturityRange): void {
  setOption('maturityRange', typeof years === 'number' ? years.toString() : years)
}


