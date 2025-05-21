import { Chart, Colors, TimeScale, LinearScale, ScatterController, LineController, PointElement, LineElement, ScatterDataPoint, Title, Tooltip, ChartEvent, ActiveElement } from 'chart.js';
import 'chartjs-adapter-date-fns';
import pluginZoom from 'chartjs-plugin-zoom';
import './style.css'
import { DataSource, DataUrl, Data, Bond } from './datasource';
import "cally"
import {CalendarDate} from "cally"
import { h } from 'start-dom-jsx'

type YieldDataPoint = ScatterDataPoint & {
  desc: string
}

type UpdateDataFn = (data: Data) => void
type SelectDataFn = (index: number) => void

type ChartSetupResult = {
  updateData: UpdateDataFn
  selectData: SelectDataFn
}

type Handler = () => void

type MaturityRange = number | "max" | undefined

function getOption(name: string, defaultValue?: string): string|undefined {
  return localStorage.getItem(name) ?? defaultValue
}

function setOption(name: string, value?: string): void {
  if (value === undefined || value === '') {
    localStorage.removeItem(name)
    return
  }
  localStorage.setItem(name, value)
}

function chartTooltipOption(): boolean {
  return getOption('chartTooltip', '1') === '1'
}

function setChartTooltipOption(enabled: boolean): void {
  setOption('chartTooltip', enabled ? undefined : '0')
}

function maturityRangeOption(): MaturityRange {
  const value = getOption('maturityRange')

  if (value === undefined) {
    return undefined
  }

  if (value === 'max') {
    return 'max'
  }

  return Number(value)
}

function setMaturityRangeOption(years: MaturityRange): void {
  setOption('maturityRange', typeof years === 'number' ? years.toString() : years)
}

/**
 * Calculate a yield curve from the data points using a tricube kernel function.
 * @param bandwidth Controls smoothness (lower = follows data more closely, higher = smoother)
 * @param numPoints Number of points on the curve (higher = smoother visualization)
 */
function calcYieldCurve(
  data: YieldDataPoint[], 
  bandwidth = 0.2, 
  numPoints = 100
): YieldDataPoint[] {
  const sorted = [...data].sort((a, b) => a.x - b.x);

  const minX = sorted[0].x;
  const maxX = sorted[sorted.length - 1].x;
  const range = maxX - minX;
  
  const a = [];
  
  for (let i = 0; i < numPoints; i++) {
    // Calculate evenly spaced x value
    const x = minX + (i / (numPoints - 1)) * range;
    
    // Calculate weighted average for this x value
    let weightedSum = 0;
    let weightSum = 0;
    
    for (let j = 0; j < sorted.length; j++) {
      // Calculate normalized distance
      const distance = Math.abs(x - sorted[j].x) / range;
      
      // Apply tricube kernel function for weighting
      let weight = 0;
      if (distance < bandwidth) {
        const normalizedDist = distance / bandwidth;
        weight = Math.pow(1 - Math.pow(normalizedDist, 3), 3);
      }
      
      // Add weighted contribution
      weightedSum += weight * sorted[j].y;
      weightSum += weight;
    }

    a.push({
      x: x,
      y: weightSum > 0 ? weightedSum / weightSum : 0,
      desc: '',
    });
  }
  
  return a;
}

function yearDiff(a: Date, b: Date): number {
  const monthDiff = b.getMonth() - a.getMonth(),
    dayDiff = b.getDate() - a.getDate()

  let years = b.getFullYear() - a.getFullYear()
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years--;
  }

  return years;
}

function setupChart(): ChartSetupResult {
  const canvas = document.getElementById('chart');

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element not found');
  }

  Chart.register(TimeScale)
  Chart.register(LinearScale)
  Chart.register(ScatterController)
  Chart.register(LineController)
  Chart.register(PointElement)
  Chart.register(LineElement)
  Chart.register(Colors)
  Chart.register(pluginZoom)
  Chart.register(Title)
  Chart.register(Tooltip)

  const zoomCompleteHandlers: Handler[] = []

  const onDatapointSelected = (_event: ChartEvent, elements: ActiveElement[], _chart: Chart) => {
    if (!elements?.length) {
      return
    }

    const current = elements.find(({datasetIndex}) => datasetIndex === 0)
    if (!current) {
      return
    }
    const {index} = current

    const datasheet = document.getElementById('datasheet')

    if (!datasheet) {
      return
    }

    datasheet.querySelectorAll('tbody tr.bg-primary')
      .forEach((tr) => tr.classList.remove('bg-primary'))

    const tr = datasheet.querySelector(`tbody tr:nth-child(${index + 1})`)
    if (tr) {
      tr.classList.add('bg-primary')
      tr.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }

  const chart = new Chart<"scatter"|"line", YieldDataPoint[]>(canvas, {
    type: 'scatter',
    data: {
      labels: [],
      datasets: [
        {
        type: 'scatter',
        label: 'UK Gilts',
        data: [],
        borderWidth: 1,
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        pointRadius: 5,
        pointHoverRadius: 10,
      },
      {
        type: 'line',
        label: 'Yield Curve',
        data: [],
        pointRadius: 0,
        tension: 0.4,
        pointHitRadius: 0,
        pointHoverRadius: 0,
        
      },      
    ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        axis: 'xy',
        intersect: false,
        // @ts-ignore
        filter: (item) => item.datasetIndex === 0,

      },      
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'month',
            displayFormats: {
              month: 'MMM yyyy'
            },
            tooltipFormat: 'MMM yyyy',
          },
          title: {
            display: true,
            text: 'Maturity Date'
          },
          ticks: {
            autoSkip: true,
          },
        },
        y: {
          beginAtZero: false,
          title: {
            display: true,
            text: 'Yield to Maturity'
          },
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (ctxs) => {
              return ctxs.map((ctx) => {
                const { dataset, dataIndex } = ctx,
                data = dataset?.data[dataIndex],
                {desc} = data as unknown as YieldDataPoint
                return desc
              })
            },
            label: (ctx) => {
              const { dataset, dataIndex } = ctx,
                data = dataset?.data[dataIndex],
                {x,y} = data as unknown as YieldDataPoint

              return [
                `${y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
                new Date(x).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })
              ]
            },
          },
          enabled: chartTooltipOption(),
        },
        title: {
          display: true,
          font: {
            size: 16
          },
        },        
        zoom: {
          pan: {
              enabled: true,
              mode: 'x',
          },
          zoom: {
              wheel: {
                  enabled: true,
                  modifierKey: 'shift',
              },
              pinch: {
                  enabled: true
              },
              mode: 'x',
              onZoomComplete: () => zoomCompleteHandlers?.forEach((handler) => handler())
          },
          limits: {
            x: {
              min: 0,
              max: 1_000_000_000_000_000,
              minRange: 1_000 * 60 * 60 * 24 * 365
            },
            y: {
              min: -1,
              max: 1,
              minRange: 0.01
            }
          }
        }
      },
      onClick: onDatapointSelected,
      onHover: onDatapointSelected,
    }
  })

  const padYearRange = (min: Date, max: Date, years: number) => {
    const monthsPadding = 1/25 * years * 12

    min.setUTCMonth(min.getUTCMonth() - monthsPadding)
    max.setUTCMonth(max.getUTCMonth() + monthsPadding)
  }

  const padYieldRange = (min: number, max: number) => {
    const scaleYPadding = 0.25

    return [
      min - scaleYPadding,
      max + scaleYPadding
    ]
  }

  let maturityRange = maturityRangeOption()

  if (!maturityRange) {
    if (window.innerWidth < 768) {
      maturityRange = 5
    } else if (window.innerWidth < 1024) {
      maturityRange = 10
    }
  }

  function setMaturityRange(range: MaturityRange, restrictYieldRange: boolean = false) {
    if (range === undefined) {
      range = "max"
    }

    const {data} = chart.data.datasets[0],
      x = data.map(({x}) => x)

    const xMin = x.reduce((min, x) => !min || x < min ? x : min, new Date(8_640_000_000_000_000).getTime())
    const zoomXMin = new Date(xMin)

    let zoomXMax

    if (range === "max") {
      const xMax = x.reduce((max, x) => !max || x > max ? x : max, new Date(0).getTime())
      zoomXMax = new Date(xMax)
      const diff = yearDiff(zoomXMin, zoomXMax)
      padYearRange(zoomXMin, zoomXMax, diff)
    } else {
      zoomXMax = new Date(xMin)
      zoomXMax.setFullYear(zoomXMax.getFullYear() + range)
      padYearRange(zoomXMin, zoomXMax, range)
    }

    chart.zoomScale('x', {
      min: zoomXMin.getTime(),
      max: zoomXMax.getTime()
    }, 'default')

    if (restrictYieldRange) {
      const {minY, maxY} = data.filter(({x}) => x >= zoomXMin.getTime() && x <= zoomXMax.getTime())
        .reduce((acc, {y}) => {
          if (y < acc.minY) {
            acc.minY = y
          }
          if (y > acc.maxY) {
            acc.maxY = y
          }
          return acc
        }, {minY: Number.MAX_VALUE, maxY: 0})

      const [zoomMinY, zoomMaxY] = padYieldRange(minY, maxY)

      chart.zoomScale('y', {
        min: zoomMinY,
        max: zoomMaxY
      }, 'default')
    }

    maturityRange = range
  }

  let maxMaturityYears: number | undefined

  const updateData: UpdateDataFn = ({ts, data: bonds}: Data) => {
    const data = bonds.map((bond) => ({
        x: bond.MaturityDate.getTime(),
        y: bond.YieldToMaturity,
        desc: bond.Desc,
      }))

    chart.data.labels = data.map(({x}) => x)
    chart.data.datasets[0].data = data
    chart.data.datasets[1].data = calcYieldCurve(data, 0.2, 100)

    const minX = data.reduce((min, data) => !min || data.x < min ? data.x : min, new Date(8_640_000_000_000_000).getTime())
    const maxX = data.reduce((max, data) => !max || data.x > max ? data.x : max, new Date(0).getTime())

    const scaleMinX = new Date(minX),
      scaleMaxX = new Date(maxX),
      years = yearDiff(scaleMinX, scaleMaxX)

    padYearRange(scaleMinX, scaleMaxX, years)

    maxMaturityYears = yearDiff(scaleMinX, scaleMaxX)

    const minY = data.reduce((min, data) => !min || data.y < min ? data.y : min, Number.MAX_VALUE)
    const maxY = data.reduce((max, data) => !max || data.y > max ? data.y : max, 0)

    const [scaleMinY, scaleMaxY] = padYieldRange(minY, maxY)

    const {scales} = chart.options
    if (scales) {
      const {x,y} = scales
      if (x) {
        x.min = scaleMinX.getTime()
        x.max = scaleMaxX.getTime()
      }
      if (y) {
        y.min = scaleMinY
        y.max = scaleMaxY
      }
    }

    const {plugins} = chart.options
    if (plugins) {
      const {zoom, title} = plugins

      if (title) {
        title.text = ts.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      }

      if (zoom) {
        const {limits} = zoom
        if (limits) {
          const {x,y} = limits
          if (x) {
            x.min = scaleMinX.getTime()
            x.max = scaleMaxX.getTime()
          }
          if (y) {
            y.min = scaleMinY
            y.max = scaleMaxY
          }
        }
      }

      setMaturityRange(maturityRange, false)
    }

    chart.update()
  }

  const maturityGroup = document.getElementById('maturity')

  if (maturityGroup) {
    maturityGroup.addEventListener('change', (event) => {
      const {target} = event
  
      if (target instanceof HTMLInputElement && target.name === 'maturity_range') {
        const {value} = target

        let range: MaturityRange
        if (value === 'max') {
          range = 'max'
        } else {
          range = Number(value)
          if (isNaN(range)) {
            range = undefined
          }
        }
        setMaturityRangeOption(range)
        setMaturityRange(range)
      }
    })

    const checkOption = (years: MaturityRange) => {
      const radio = maturityGroup.querySelector<HTMLInputElement>(`input[name="maturity_range"][value="${years ?? "max"}"]`)
      if (radio) {
        radio.checked = true
      }
    }

    const clearChecks = () => {
      for (const radio of maturityGroup.querySelectorAll<HTMLInputElement>(`input[name="maturity_range"]`)) {
        radio.checked = false
      }
    }

    checkOption(maturityRange)

    zoomCompleteHandlers.push(() => {
      const {min, max} = chart.scales.x,
        years = yearDiff(new Date(min), new Date(max))
      clearChecks()
      checkOption(years >= (maxMaturityYears ?? 50) ? 'max' : years)
    })

    const displayOptions = document.getElementById('display-options')
    if (displayOptions) {
      const input = displayOptions.querySelector<HTMLInputElement>('input[name="display_tooltips"]')
      if (input) {
        input.checked = chart.options.plugins?.tooltip?.enabled ? true : false
      }
      displayOptions.addEventListener('change', (e) => {
        const {target} = e

        if (!(target instanceof HTMLInputElement)) {
          return
        }

        if (target.name === 'display_tooltips') {
          const {plugins} = chart.options
          if (plugins && plugins.tooltip) {
            plugins.tooltip.enabled = target.checked
            setChartTooltipOption(target.checked)
            chart.update()
          }
        }
      })
    }
  }

  const selectData: SelectDataFn = (index: number) => {
    chart.setActiveElements([{datasetIndex: 0, index}])

    const a = chart.getActiveElements()
    if (a.length) {
      const ae = a[0],
        {element} = ae,
        {x,y} = element

      chart.tooltip?.setActiveElements([ae], {x,y})

      const {chartArea} = chart;
      if (chartArea) {
        const {left, right} = chartArea
        const padding = (right - left) * 0.1

        let panX = 0
        if (x < left) {
          panX = (left - x) + padding
        } else if (x > right) {
          panX = (right - x) - padding
        }

        if (panX) {
          chart.pan({ x: panX }, undefined, 'default');
        }        
      }
    }

    chart.update()
  }  

  return { updateData, selectData }
}

function setupDatasheet(onDataChange?: SelectDataFn): UpdateDataFn {
  const datasheet = document.getElementById('datasheet')

  if (!datasheet) {
    throw new Error('Datasheet element not found')
  }
  
  const tbody = datasheet.querySelector("tbody")
  if (!(tbody instanceof HTMLTableSectionElement)) {
    throw new Error('Datasheet tbody element not found')
  }

  tbody.addEventListener('click', (e) => {
    const {target} = e

    if (!(target instanceof HTMLElement)) {
      return
    }

    const rows = Array.from(tbody.querySelectorAll('tbody tr'))

    rows.forEach((tr) => tr.classList.remove('bg-primary'))

    const tr = target.closest('tr')
    if (!tr) {
      return
    }

    tr.classList.add('bg-primary')

    const index = rows.indexOf(tr)

    onDataChange?.(index)
  })

  const updateData: UpdateDataFn = ({data: bonds}: Data) => {
    tbody.innerHTML = ''

    const currencyFormat = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'GBP',
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    const percentFormat = new Intl.NumberFormat(undefined, {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    const dateFormat = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    })

    const formatMaturity = ({MaturityYears, MaturityDays}: Bond) => {
      const years = MaturityYears.toLocaleString() + " " + (MaturityYears > 1 ? "years" : "year")
      const days = MaturityDays.toLocaleString() + " " + (MaturityDays > 1 ? "days" : "day")

      if (MaturityYears > 0) {
        if (MaturityDays > 0) {
          return years + ", " + days
        }
        return years
      }

      if (MaturityDays > 0) {
        return days
      }

      return "Now"
    }

    bonds.forEach((bond: Bond) => {
      
      const tr = <tr>
        <td class="p-2 md:p-4">{bond.Desc}<br/>{bond.ISIN}</td>
        <td class="p-2 md:p-4"><span class="whitespace-nowrap">{bond.Coupon}%</span><br/><span class="whitespace-nowrap">{dateFormat.format(bond.NextCouponDate)}</span></td>
        <td class="p-2 md:p-4"><span class="whitespace-nowrap">{percentFormat.format(bond.YieldToMaturity)}%</span></td>
        <td class="p-2 md:p-4"><span class="whitespace-nowrap">{dateFormat.format(bond.MaturityDate)}</span><br/><span class="whitespace-nowrap">{formatMaturity(bond)}</span></td>
        <td class="p-2 md:p-4">{currencyFormat.format(bond.CleanPrice)}<br/>{currencyFormat.format(bond.DirtyPrice)}</td>
      </tr>
      tbody.appendChild(tr)
    })
  }

  return updateData
}

async function main() {
  const { updateData: updateChartData, selectData: selectChartData } = setupChart()
  const updateDatasheet = setupDatasheet(selectChartData)

  const ds = new DataSource('DMO')

  let currTs: Date | undefined

  const updateDataUrl = async (dataUrl: DataUrl) => {
    const data = await ds.getData(dataUrl)
    updateChartData?.(data)
    updateDatasheet?.(data)
    currTs = dataUrl.ts
  }

  const latest = async () => {
    const dataUrl = await ds.getLatestDataUrl()
    if (dataUrl) {
      await updateDataUrl(dataUrl)
    }  
  }

  await latest()

  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar')
  toggleSidebarBtn?.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()

    const sidebar = document.getElementById('sidebar')
    if (sidebar) {
      sidebar.classList.toggle('max-lg:hidden')
      sidebar.classList.toggle('lg:hidden')
    }
  })

  const toCalValue = (ts?: Date) => ts ? ts.toISOString().split('T')[0] : ''

  const latestBtn = document.getElementById('btn-latest')
  latestBtn?.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()

    await latest()
    
    if (calendar instanceof CalendarDate) {
      calendar.value = toCalValue(currTs)
    }
  })

  const calendar = document.getElementById('settlement-date-calendar')
  if (calendar instanceof CalendarDate) {
    const setValue = (ts?: Date) => calendar.value = toCalValue(ts)

    setValue(currTs)
    
    calendar.isDateDisallowed = (date: Date) => {
      return ds.hasData(date) !== true
    }

    calendar.addEventListener('change', async (e) => {
      const {target} = e
      if (target instanceof CalendarDate) {
        const dataUrl = await ds.getDataUrl(new Date(target.value))
        if (dataUrl) {
          updateDataUrl(dataUrl)
        } else {
          setValue(currTs)
        }  
      }
    })
  }

}

main().catch(console.error)

