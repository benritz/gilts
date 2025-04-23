import { Chart, Colors, TimeScale, LinearScale, ScatterController, LineController, PointElement, LineElement, ScatterDataPoint, Title, Tooltip } from 'chart.js';
import 'chartjs-adapter-date-fns';
import pluginZoom from 'chartjs-plugin-zoom';
import './style.css'
import { Bond, DataSource, DataUrl } from './datasource';

type YieldDataPoint = ScatterDataPoint & {
  desc: string
}

type UpdateYieldDataFn = (ts: Date, data: Bond[]) => void

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

function setupChart(): UpdateYieldDataFn {
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
      },      
    ]
    },
    options: {
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
            }
          }
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
          },
          limits: {
            x: {
              min: 0,
              max: 1_000_000_000_000_000,
            },
            y: {
              min: -1,
              max: 1,
              minRange: 0.01
            }
          }
        }
      }
    }
  })  
    
  const yearDiff = (a: Date, b: Date): number => {
    const monthDiff = b.getMonth() - a.getMonth(),
      dayDiff = b.getDate() - a.getDate()
  
    let years = b.getFullYear() - a.getFullYear()
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      years--;
    }
  
    return years;
  }

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

  const updateData: UpdateYieldDataFn = (ts: Date, bonds: Bond[]) => {
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
    }

    chart.update()
  }

  const zoomResetBtn = document.getElementById('zoom-reset');
  if (zoomResetBtn instanceof HTMLButtonElement) {
    zoomResetBtn.addEventListener('click', () => {
      chart.resetZoom()
    })
  }

  function zoomYears(years: number, restrictYieldRange: boolean = false) {
    const {data} = chart.data.datasets[0]

    const xMin = data.map(({x}) => x)
      .reduce((min, x) => !min || x < min ? x : min, new Date(8_640_000_000_000_000).getTime())

    const zoomXMin = new Date(xMin)
    const zoomXMax = new Date(xMin)
    zoomXMax.setFullYear(zoomXMax.getFullYear() + years)
    padYearRange(zoomXMin, zoomXMax, years)

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
  }

  [5, 10, 20].forEach((years: number) => {
    const btn = document.getElementById(`zoom-${years}`);
    if (btn instanceof HTMLButtonElement) {
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        zoomYears(years)
      })
    }
  })

  return updateData
}

async function main() {
  const updateData = setupChart()

  const ds = new DataSource('DMO')

  const dataUrl = await ds.getLatestDataUrl()

  if (!dataUrl) {
    alert('No data found')
    return
  }

  const {ts, url} = dataUrl

  const data: Bond[] = (await ds.getData(url))
    .filter((bond) => !bond.Desc.toLowerCase().includes('index-linked'))

  updateData?.(ts, data)

  const select = document.getElementById('settlement-date-select')
  if (select instanceof HTMLSelectElement) {
    const dataUrls = await ds.getDataUrls(180)
    dataUrls.forEach(({ts}: DataUrl, n: number) => {
      const option = document.createElement('option')
      option.value = n.toString()
      option.textContent = ts.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      select.appendChild(option)
    })
    select.addEventListener('change', async (e) => {
      e.preventDefault()
      e.stopPropagation()

      const n = Number((e.target as HTMLSelectElement).value)
      const {ts, url} = dataUrls[n]

      const data: Bond[] = (await ds.getData(url))
        .filter((bond) => !bond.Desc.toLowerCase().includes('index-linked'))

      updateData?.(ts, data)
    })
  }
}

main().catch(console.error)

