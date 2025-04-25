
interface DateRange {
    start: Date
    end: Date
}

export class DateRangeCache {
    private name: string
    private ranges: DateRange[]|undefined

    private _normalise(date: Date): Date {
        const v = new Date(date)
        v.setUTCHours(0, 0, 0, 0)
        return v
    }

    // Merge overlapping or adjacent ranges in the cache
    // Assumes the ranges array is sorted by startDate
    private _mergeRanges(ranges: DateRange[]): DateRange[] {
        if (ranges.length <= 1) {
            return ranges
        }

        const merged: DateRange[] = []
        let curr: DateRange | undefined

        for (const range of ranges) {
            if (!curr) {
                curr = { ...range }
                continue
            }

            // check if the current range overlaps or is adjacent to the merged range

            // adjacency check with a 1-day buffer
            const addDays = (date: Date, days: number): Date => {
                const v = new Date(date)
                v.setUTCDate(v.getUTCDate() + days)
                return v
            }

            const dayAfterEndDate = addDays(curr.end, 1)

            if (range.start.getTime() <= dayAfterEndDate.getTime()) {
                // overlap or adjacency detected
                // extend the current merge range if necessary
                if (range.end.getTime() > curr.end.getTime()) {
                    curr.end = range.end
                }
            } else {
                // no overlap/adjacency
                // finalize the current merge range and start a new range
                merged.push(curr)
                curr = { ...range }
            }
        }

        if (curr) {
            merged.push(curr);
        }

        return merged
    }

    private _loadRanges(): DateRange[] {
        if (!this.ranges) {
            let ranges: DateRange[] = []

            const v = localStorage.getItem(this.name)
            if (v) {
                try {
                    ranges = JSON.parse(v)
                        .map(([start,end]: number[]) => ({start: new Date(start), end: new Date(end)}))
                } catch (e) {
                    console.error('Failed to parse cache', e)
                }
            }

            this.ranges = ranges
        }

        return this.ranges
    }

    private _storeRanges(ranges: DateRange[]): void {
        if (ranges.length) {
            // encode the ranges as a timestamp start/end tuple
            const a = ranges.map(({start,end}) => [start.getTime(), end.getTime()])
            localStorage.setItem(this.name, JSON.stringify(a))
        } else {
            localStorage.removeItem(this.name)
        }

        this.ranges = ranges
    }

    public constructor(name: string) {
        this.name = name
    }
  
    public has(date: Date): boolean {
        const ts = this._normalise(date).getTime()

        const ranges = this._loadRanges()

        for (const {start,end} of ranges) {
            if (ts >= start.getTime() && ts <= end.getTime()) {
                return true
            }

            if (start.getTime() > ts) {
                break;
            }
        }

        return false
    }
  
    public add(date: Date): void {
        if (this.has(date)) {
            return
        }

        const d = this._normalise(date)

        const newRange: DateRange = {
            start: d,
            end: d,
        }

        const ranges = this._loadRanges()
  
        // insert the new range in sorted order then merge the ranges
        let inserted = false;
        for (let i = 0; i < ranges.length; i++) {
            if (newRange.start.getTime() < ranges[i].start.getTime()) {
                ranges.splice(i, 0, newRange)
                inserted = true
                break
            }
        }

        if (!inserted) {
            ranges.push(newRange)
        }

        const merged = this._mergeRanges(ranges)
        this._storeRanges(merged)
    }

    public invalidate(): void {
      this.ranges = []
    }
  }
