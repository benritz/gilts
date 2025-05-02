import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { DateRangeCache } from './cache'

export type Bond = {
    Type: string,
    Source: string,
    ISIN: string,
    Desc: string,
    FacePrice: number,
    CleanPrice: number,
    DirtyPrice: number,
    Coupon: number,
    SettlementDate: Date,
    MaturityDate: Date,
    YieldToMaturity: number,
}
  
const baseUrl = `${import.meta.env.VITE_BASE_URL ?? ''}/data`
  
export type DataUrl = {
    ts: Date,
    url: string
}

export type Data = {
  ts: Date,
  data: Bond[]
}

function isToday(ts: Date): boolean {
  const today = new Date()
  return ts.getUTCFullYear() === today.getUTCFullYear() &&
    ts.getUTCMonth() === today.getUTCMonth() &&
    ts.getUTCDate() === today.getUTCDate()
}

function isAfterToday(ts: Date): boolean {
  const tomorrow = new Date()
  tomorrow.setUTCHours(0, 0, 0, 0)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return ts.getTime() >= tomorrow.getTime()
}

function isWeekend(ts: Date): boolean {
  switch (ts.getUTCDay()) {
    case 0: // Sunday
    case 6: // Saturday
      return true
  }
  return false
}

export class DataSource {
    private type: string
    private missCache: DateRangeCache

    private getUrlForTs(ts: Date): string {
        const year = ts.getUTCFullYear(),
          month = ts.getUTCMonth() + 1,
          date = ts.getUTCDate()

        return `${baseUrl}/${year}/${month.toString().padStart(2, '0')}/${date.toString().padStart(2, '0')}/${this.type}.parquet`
    }

    constructor(type: string) {
        this.type = type
        this.missCache = new DateRangeCache(`${type}-miss`)
    }

    hasData(ts: Date): boolean {
      return !(this.missCache.has(ts) || isWeekend(ts) || isAfterToday(ts))
    }

    async getDataUrl(ts: Date): Promise<DataUrl | undefined> {
        if (isAfterToday(ts)) {
            return undefined
        }

        const url = this.getUrlForTs(ts)
      
        if (this.missCache.has(ts)) {
            return undefined
        }

        const resp = await fetch(url, { method: 'HEAD' })

        if (!resp.ok || resp.headers.get('content-length') === '0') {
            if (!isToday(ts)) {
                this.missCache.add(ts)
            }
            return undefined
        }
  
        return {ts, url}
    }    

    async getDataUrls(maxUrls: number, maxChecks?: number, ts?: Date): Promise<DataUrl[]> {
        if (!maxChecks) {
          maxChecks = Math.max(30, maxUrls * 2)
        }

        const isWeekend = (ts: Date) => {
          switch (ts.getUTCDay()) {
            case 0: // Sunday
            case 6: // Saturday
              return true
          }
          return false
        }

        const nextDate = (ts?: Date) => {
          if (!ts) {
            ts = new Date()
            ts.setUTCHours(0, 0, 0, 0)
          } else {
            ts = new Date(ts)
            ts.setUTCDate(ts.getUTCDate() - 1)
          }
          return ts
        }

        const urls: DataUrl[] = []
      
        while (maxChecks > 0) {
          ts = nextDate(ts)
          // no bond data on weekends
          // do not count as a check
          if (isWeekend(ts)) {
            continue
          }

          const url = await this.getDataUrl(ts)
          if (url) {
            urls.push(url)
            if (urls.length >= maxUrls) {
              break
            }
          }

          maxChecks--
        }
      
        return urls
    }

    async getLatestDataUrl(maxChecks:number = 30): Promise<DataUrl | undefined> {
      const urls = await this.getDataUrls(1, maxChecks)
      return urls[0]
    }

    async getData(dataUrl: DataUrl): Promise<Data> {
      const { ts, url } = dataUrl,
        file = await asyncBufferFromUrl({ url })

      const data = (await parquetReadObjects({ file }) as Bond[])
        .filter((bond) => !bond.Desc.toLowerCase().includes('index-linked'))  

      return { ts, data }
    }
}
  