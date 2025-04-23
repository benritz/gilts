
export class Cache {
    private name: string
    private cache: Set<number>|undefined = undefined

    private getCache() {
        if (!this.cache) {
            let data: number[] = []

            const v = localStorage.getItem(this.name)
            if (v) {
                try {
                    data = JSON.parse(v)
                } catch (e) {
                    console.error('Failed to parse cache', e)
                }
            }

            this.cache = new Set<number>(data)
        }

        return this.cache
    }

    private storeCache() {
        if (this.cache) {
            localStorage.setItem(this.name, JSON.stringify(Array.from(this.cache)))
        } else {
            localStorage.removeItem(this.name)
        }
    }

    constructor(name: string) {
        this.name = name
    }

    add(ts: Date) {
        const cache = this.getCache()
        cache.add(ts.getTime())
        this.storeCache()
    }

    has(ts: Date): boolean {
        const cache = this.getCache()
        return cache.has(ts.getTime())
    }
}
