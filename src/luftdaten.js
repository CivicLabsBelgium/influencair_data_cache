const got = require('got')
const fs = require('fs-extra')
const path = require('path')
const GeocoderGeonames = require('geocoder-geonames')

const geocoder = new GeocoderGeonames({
    username: 'toon_nelissen'
})

const storageDirectoryPath = path.join(__dirname, '..', 'storage')
const staticDirectoryPath = path.join(__dirname, '..', 'static')

const valueTypes = valueType => {
    switch (valueType) {
    case 'P1':
        return 'PM10'

    case 'P2':
        return 'PM25'

    default:
        return valueType
    }
}

const updateSensorWithMeanValues = (sensorMeans) => {
    const meansData = {}
    sensorMeans.forEach(mean => {
        meansData[valueTypes(mean.value_type)] = mean.value
    })
    return meansData
}

class Luftdaten {
    constructor () {
        this.data = []
        this.hourlyMap = new Map()
        this.dailyMap = new Map()
        this.cityForLocation = new Map()

        this.currentData = []

        this.getCurrentData = this.getCurrentData.bind(this)
        this.getMeans = this.getMeans.bind(this)
        this.parseCurrentData = this.parseCurrentData.bind(this)
        this.createStaticJsonFiles = this.createStaticJsonFiles.bind(this)
        this.updateCityData = this.updateCityData.bind(this)
        this.calculateRankings = this.calculateRankings.bind(this)

        // setInterval(() => this.getCurrentData(), 1000 * 60 * 1)
        // setInterval(() => this.getMeans(), 1000 * 60 * 30)
        // this.getCurrentData()
        // this.getMeans()

        const cityForLocationPath = path.join(storageDirectoryPath, 'cityForLocation.json')

        try {
            fs.ensureFile(cityForLocationPath, err => {
                if (err) throw err
                fs.readJson(cityForLocationPath, (err, json) => {
                    if (err) console.error(err)
                    console.log(json)
                    this.cityForLocation = new Map(json)
                    console.log('loaded cityForLocation')
                })
            })
        } catch (error) {
            console.error(error)
        }
    }
    getCurrentData () {
        return new Promise(async (resolve, reject) => {
            if (this.gettingCurrentData) {
                console.log(`Luftdaten --> getCurrentData ERROR: still running`)
                return
            }
            this.gettingCurrentData = true
            const request = got(`http://api.luftdaten.info/static/v2/data.json`, {
                json: true
            })
            let response
            try {
                response = await request
            } catch (error) {
                console.log(`Luftdaten --> getCurrentData ERROR: ${error.name} for ${error.url}`)
                this.gettingCurrentData = false
                return reject(error)
            }
            const currentData = response.body
            if (Array.isArray(currentData)) {
                this.currentData = currentData
            } else {
                console.log(`Luftdaten --> getCurrentData ERROR: response is not an Array`)
            }
            this.gettingCurrentData = false
            console.log('got luftdaten current data ', new Date())
            resolve()
        })
    }
    getMeans () {
        return new Promise(async (resolve, reject) => {
            try {
                const hourly = (await got(`https://api.luftdaten.info/static/v2/data.1h.json`, { json: true })).body
                const daily = (await got(`https://api.luftdaten.info/static/v2/data.24h.json`, { json: true })).body

                if (Array.isArray(hourly)) {
                    const hourlyMap = new Map()
                    hourly.forEach(record => hourlyMap.set(`L-${record.sensor.id}`, record.sensordatavalues))
                    this.hourlyMap = hourlyMap
                } else {
                    console.log('hourly')
                }
                if (Array.isArray(daily)) {
                    const dailyMap = new Map()
                    daily.forEach(record => dailyMap.set(`L-${record.sensor.id}`, record.sensordatavalues))
                    this.dailyMap = dailyMap
                } else {
                    console.log('daily')
                }
                console.log('got luftdaten means ', new Date())
                resolve()
            } catch (error) {
                console.log(`Luftdaten --> getMeans ERROR: ${error.name} for ${error.url}`)
                reject(error)
            }
        })
    }
    parseCurrentData () {
        const currentData = this.currentData
        let sensorLocations = []
        currentData.forEach((station) => {
            let isValid = true
            let isNew = false

            const location = this.cityForLocation.get(station.location.id)
            const city = location ? location.city : ''

            let parsedSensorLocation = sensorLocations.find((existingSensorLocation) => existingSensorLocation.id === station.location.id)
            if (!parsedSensorLocation) {
                isNew = true
                parsedSensorLocation = {
                    id: station.location.id,
                    latitude: station.location.latitude,
                    longitude: station.location.longitude,
                    altitude: station.location.altitude,
                    country: station.location.country,
                    city,
                    origin: 'luftdaten',
                    timestamp: station.timestamp,
                    sensors: []
                }
            }

            // TODO sensor can already be in the sensor list. And some phenomenom are send at a different time

            const currentSensor = {
                id: station.sensor.id,
                manufacturer: station.sensor.sensor_type.manufacturer,
                name: station.sensor.sensor_type.name,
                stationID: station.location.id
            }

            for (let s in station.sensordatavalues) {
                let currentSensorDataValue = station.sensordatavalues[s]

                switch (currentSensorDataValue.value_type) {
                case 'P1':
                    if (currentSensorDataValue.value < 1990) {
                        currentSensor.PM10 = Number.parseFloat(currentSensorDataValue.value).toFixed(2)
                    } else {
                        isValid = false
                    }
                    break
                case 'P2':
                    if (currentSensorDataValue.value < 990) {
                        currentSensor.PM25 = Number.parseFloat(currentSensorDataValue.value).toFixed(2)
                    } else {
                        isValid = false
                    }
                    break
                case 'temperature':
                    if (currentSensorDataValue.value >= -100 && currentSensorDataValue.value <= 100) {
                        currentSensor.temperature = Number.parseFloat(currentSensorDataValue.value).toFixed(2)
                    } else {
                        isValid = false
                    }
                    break
                case 'humidity':
                    if (currentSensorDataValue.value >= 0 && currentSensorDataValue.value <= 100) {
                        currentSensor.humidity = Number.parseFloat(currentSensorDataValue.value).toFixed(2)
                    } else {
                        isValid = false
                    }
                    break
                case 'pressure_at_sealevel':
                    if (currentSensorDataValue.value >= 90000 && currentSensorDataValue.value <= 120000) {
                        currentSensor.pressure = Number.parseFloat(currentSensorDataValue.value / 100).toFixed(2)
                    } else {
                        isValid = false
                    }
                    break
                default:
                    break
                }
            }

            let sensorHourly = this.hourlyMap.get(currentSensor.id)
            let sensorDaily = this.dailyMap.get(currentSensor.id)
            if (sensorHourly) {
                currentSensor.hourly = updateSensorWithMeanValues(sensorHourly)
            }
            if (sensorDaily) {
                currentSensor.daily = updateSensorWithMeanValues(sensorDaily)
            }

            parsedSensorLocation.sensors.push(currentSensor)

            if (isValid && isNew) sensorLocations.push(parsedSensorLocation)
        })

        this.dataTimeStamp = new Date()
        this.data = sensorLocations
        console.log('got luftdaten currentData ', new Date())
    }

    createStaticJsonFiles () {
        return new Promise((resolve, reject) => {
            const dataPerCountry = this.data.reduce((acc, sensorLocation) => {
                const countryArray = acc[sensorLocation.country] || []
                acc[sensorLocation.country] = [...countryArray, sensorLocation]
                return acc
            }, {})

            for (const key in dataPerCountry) {
                if (dataPerCountry.hasOwnProperty(key)) {
                    const countryDataJSON = {
                        name: `Current luftdaten data from ${key}`,
                        description: '',
                        source: 'http://api.luftdaten.info/static/v2/data.json',
                        origin: `https://data.influencair.be/now/${key}/data.json`,
                        author: 'Toon Nelissen',
                        // documentation: 'https://documentation.influencair.be',
                        timestamp: (new Date()).toJSON(),
                        data: dataPerCountry[key]
                    }
                    const countrypath = path.join(staticDirectoryPath, 'now', key)
                    try {
                        fs.outputJson(path.join(countrypath, 'data.json'), countryDataJSON, (err) => {
                            if (err) throw err
                        })
                    } catch (err) {
                        console.error(err)
                        reject(err)
                    }
                }
            }
            const worldDataJSON = {
                name: 'Current luftdaten data',
                description: '',
                source: 'http://api.luftdaten.info/static/v2/data.json',
                origin: `https://data.influencair.be/now/data.json`,
                author: 'Toon Nelissen',
                // documentation: 'https://documentation.influencair.be',
                timestamp: (new Date()).toJSON(),
                data: this.data
            }
            try {
                fs.outputJson(path.join(staticDirectoryPath, 'now', 'data.json'), worldDataJSON, (err) => {
                    if (err) throw err
                })
            } catch (error) {
                reject(error)
            }
            resolve()
        })
    }
    updateCityData () {
        return new Promise(async (resolve, reject) => {
            let fetchLimit = 20
            let fetchCounter = 0
            const now = new Date()
            if (this.updatingCityData) return
            this.updatingCityData = true
            // loop over this data
            for (const sensorLocation of this.data) {
                const sensors = sensorLocation.sensors.reduce((acc, sensor) => {
                    acc.push(sensor.id)
                    return acc
                }, [])
                if (!this.cityForLocation.has(sensorLocation.id) || typeof this.cityForLocation.get(sensorLocation.id) === 'string') {
                    try {
                        if (~~sensorLocation.latitude && ~~sensorLocation.longitude) {
                            const response = await geocoder.get('findNearbyPlaceName', {
                                lat: sensorLocation.latitude,
                                lng: sensorLocation.longitude,
                                cities: 'cities1000'
                            })
                            if (Array.isArray(response.geonames) && response.geonames[0]) {
                                this.cityForLocation.set(sensorLocation.id, {
                                    city: response.geonames[0].name,
                                    lat: response.geonames[0].lat,
                                    lng: response.geonames[0].lng,
                                    country: response.geonames[0].countryName,
                                    lastSeenDate: now,
                                    sensors
                                })
                            } else {
                                console.log(response, sensorLocation)
                                if (response.status && response.status.value === 19) fetchCounter = fetchLimit
                            }
                            fetchCounter++
                        }
                    } catch (error) {
                        if (error.code === 401) fetchCounter = fetchLimit
                        fetchCounter++
                        console.log(error)
                    }
                } else {
                    const sensorlocationFromMap = this.cityForLocation.get(sensorLocation.id)
                    sensorlocationFromMap.lastSeenDate = now
                    sensorlocationFromMap.sensors = sensors
                    this.cityForLocation.set(sensorLocation.id, sensorlocationFromMap)
                }

                if (fetchCounter >= fetchLimit) break
            }
            const cityForLocationPath = path.join(storageDirectoryPath, 'cityForLocation.json')
            try {
                fs.outputJson(cityForLocationPath, [...this.cityForLocation], (err) => {
                    if (err) throw err
                    console.log('The file cityForLocation.json, has been saved! With ' + this.cityForLocation.size + 'records')
                })
            } catch (error) {
                reject(error)
            }
            this.updatingCityData = false
            resolve()
        })
    }
    calculateRankings () {
        const DAY = 1000 * 60 * 60 * 24
        const aDayAgo = Date.now() - DAY

        const citiesArray = []
        const countriesArray = []
        const cityForLocation = [...this.cityForLocation]

        const cityRanking = cityForLocation.reduce((acc, location) => {
            // old array type check
            if (typeof location[1] === 'string') return acc

            // only count the sensors seen the last day
            if (!location[1].lastSeenDate || (location[1].lastSeenDate && location[1].lastSeenDate < aDayAgo)) return acc

            const country = acc[location[1].country] || { name: location[1].country, amount: 0, cities: {} }
            const city = country.cities[location[1].city] || { name: location[1].city, amount: 0, lat: location[1].lat, lng: location[1].lng }

            country.amount = country.amount + 1
            city.amount = city.amount + 1
            country.cities[location[1].city] = city
            acc[location[1].country] = country
            return acc
        }, {})

        for (const countryName in cityRanking) {
            const country = cityRanking[countryName]
            for (const cityName in country.cities) {
                const city = country.cities[cityName]
                city.country = countryName
                delete city.lat
                delete city.lng
                citiesArray.push(city)
            }
            delete country.cities
            countriesArray.push(country)
        }

        const worldArray = countriesArray.reduce((acc, country) => {
            acc.amount = acc.amount + country.amount
            return acc
        }, { name: 'World', amount: 0 })

        citiesArray.sort((a, b) => a.amount > b.amount ? -1 : b.amount > a.amount ? 1 : 0)
        countriesArray.sort((a, b) => a.amount > b.amount ? -1 : b.amount > a.amount ? 1 : 0)

        const staticRankingDirectoryPath = path.join(staticDirectoryPath, 'ranking')

        const cityRankingJSON = {
            name: 'city ranking amount of luftdaten sensors last 24h',
            description: 'This ranking is composed from querying the source every 3 minutes and keeping track of all the unique sensor locations. Second all locations were enriched with a city name via geonames.org endpoint "findNearbyPlaceName". The ranking only includes sensors seen for the last 24 hours',
            source: 'http://api.luftdaten.info/static/v2/data.json',
            origin: 'https://data.influencair.be/ranking/cityRanking.json',
            author: 'Toon Nelissen',
            // documentation: 'https://documentation.influencair.be',
            timestamp: (new Date()).toJSON(),
            data: citiesArray
        }

        fs.outputJson(path.join(staticRankingDirectoryPath, 'cityRanking.json'), cityRankingJSON, { spaces: 4 }, (err) => {
            if (err) throw err
            console.log('The file cityRanking.json, has been saved!')
        })

        const countryRankingJSON = {
            name: 'country ranking amount of luftdaten sensors last 24h',
            description: 'This ranking is composed from querying the source every 3 minutes and keeping track of all the unique sensor locations. The ranking only includes sensors seen for the last 24 hours',
            source: 'http://api.luftdaten.info/static/v2/data.json',
            origin: 'https://data.influencair.be/ranking/countryRanking.json',
            author: 'Toon Nelissen',
            // documentation: 'https://documentation.influencair.be',
            timestamp: (new Date()).toJSON(),
            data: countriesArray
        }

        fs.outputJson(path.join(staticRankingDirectoryPath, 'countryRanking.json'), countryRankingJSON, { spaces: 4 }, (err) => {
            if (err) throw err
            console.log('The file countryRanking.json, has been saved!')
        })

        const worldRankingJSON = {
            name: 'total amount of luftdaten sensors seen last 24h',
            description: 'This ranking is composed from querying the source every 3 minutes and keeping track of all the unique sensor locations. The ranking only includes sensors seen for the last 24 hours',
            source: 'http://api.luftdaten.info/static/v2/data.json',
            origin: 'https://data.influencair.be/ranking/worldRanking.json',
            author: 'Toon Nelissen',
            // documentation: 'https://documentation.influencair.be',
            timestamp: (new Date()).toJSON(),
            data: worldArray
        }

        fs.outputJson(path.join(staticRankingDirectoryPath, 'worldRanking.json'), worldRankingJSON, { spaces: 4 }, (err) => {
            if (err) throw err
            console.log('The file worldRanking.json, has been saved!')
        })
    }
}
module.exports = Luftdaten
