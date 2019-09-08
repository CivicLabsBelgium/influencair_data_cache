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
    this.locations = new Map()

    this.currentData = []

    this.getCurrentData = this.getCurrentData.bind(this)
    this.getMeans = this.getMeans.bind(this)
    this.parseCurrentData = this.parseCurrentData.bind(this)
    this.createStaticJsonFiles = this.createStaticJsonFiles.bind(this)
    this.updateCityData = this.updateCityData.bind(this)
    this.updateLocations = this.updateLocations.bind(this)
    this.calculateRankings = this.calculateRankings.bind(this)
    this.createSensorsPerCity = this.createSensorsPerCity.bind(this)
    this.createSensorsPerCountry = this.createSensorsPerCountry.bind(this)
    this.updateSensorLocationsData = this.updateSensorLocationsData.bind(this)

    const cityForLocationPath = path.join(storageDirectoryPath, 'cityForLocation.json')
    const sensorLocationsPath = path.join(storageDirectoryPath, 'sensorLocations.json')
    const locationsPath = path.join(storageDirectoryPath, 'locations.json')

    try {
      fs.ensureFile(cityForLocationPath, err => {
        if (err) throw err
        fs.readJson(cityForLocationPath, (err, json) => {
          if (err) console.error(err)
          this.cityForLocation = new Map(json)
          console.log('loaded cityForLocation')
        })
      })
      fs.ensureFile(sensorLocationsPath, err => {
        if (err) throw err
        fs.readJson(sensorLocationsPath, (err, json) => {
          if (err) console.error(err)
          this.sensorLocations = new Map(json)
          console.log('loaded cityForLocation')
        })
      })
      fs.ensureFile(locationsPath, err => {
        if (err) throw err
        fs.readJson(locationsPath, (err, json) => {
          if (err) console.error(err)
          this.locations = new Map(json)
          console.log('loaded Locations')
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
          hourly.forEach(record => hourlyMap.set(record.sensor.id, record.sensordatavalues))
          this.hourlyMap = hourlyMap
        } else {
          console.log('hourly')
        }
        if (Array.isArray(daily)) {
          const dailyMap = new Map()
          daily.forEach(record => dailyMap.set(record.sensor.id, record.sensordatavalues))
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
      parsedSensorLocation.latitude = station.location.latitude
      parsedSensorLocation.longitude = station.location.longitude

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

      if (isValid && isNew) sensorLocations.push(parsedSensorLocation)

      const sloc = { ...parsedSensorLocation }
      delete sloc.sensors
      this.sensorLocations.set(station.location.id, sloc)
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
            documentation: 'https://docs.influencair.be/docs/doc_api_data',
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
        documentation: 'https://docs.influencair.be',
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
  createSensorsPerCity () {
    const cityList = new Map()
    const sensorLocations = [...this.sensorLocations]
    return new Promise((resolve, reject) => {
      for (const sensorLocation of sensorLocations) {
        const location = sensorLocation
        const city = cityList.get(location.city) || {
          name: location.city,
          tiles: [],
          sensorLocations: [],
          data: []
        }
        city.data.push(sensorLocation[0])
        city.sensorLocations.push([location.latitude, location.longitude])
        cityList.set(location.city, city)
      }
      cityList.forEach((cityObj, key) => {
        const sensorLocations = cityObj.sensorLocations
        const startVal = [[-360, 360], [-360, 360]]
        const minmaxLatlng = sensorLocations.reduce((acc, location) => {
          const lat = location[0]
          const lng = location[1]
          acc[0][0] = lat > acc[0][0] ? lat : acc[0][0]
          acc[0][1] = lat < acc[0][1] ? lat : acc[0][1]
          acc[1][0] = lng > acc[1][0] ? lng : acc[1][0]
          acc[1][1] = lng < acc[1][1] ? lng : acc[1][1]
          return acc
        }, startVal)
        const minLng = Math.floor(minmaxLatlng[1][0])
        const maxLng = Math.floor(minmaxLatlng[1][1])
        const minLat = Math.floor(minmaxLatlng[0][0])
        const maxLat = Math.floor(minmaxLatlng[0][1])
        const tiles = []
        for (let lng = minLng; lng <= maxLng; lng++) {
          for (let lat = minLat; lat <= maxLat; lat++) {
            tiles.push(`${lat}-${lng}`)
          }
        }
        cityObj.tiles = tiles
        delete cityObj.sensorLocations
        cityList.set(key, cityObj)
      })
      const cities = cityList.values()
      const cityListJSON = {
        name: 'sensorlocationIds per city',
        description: 'List of sensorlocation id\'s per city',
        source: 'http://api.luftdaten.info/static/v2/data.json',
        origin: 'https://data.influencair.be/cityList.json',
        author: 'Toon Nelissen',
        documentation: 'https://docs.influencair.be/docs/doc_api_data',
        timestamp: (new Date()).toJSON(),
        data: [...cities]
      }
      try {
        fs.outputJson(path.join(staticDirectoryPath, 'cityList.json'), cityListJSON, (err) => {
          if (err) throw err
          console.log('The file cityList.json, has been saved!')
          resolve()
        })
      } catch (error) {
        reject(error)
      }
    })
  }
  createSensorsPerCountry () {
    const countryList = {}
    const cityForLocation = [...this.cityForLocation]
    return new Promise((resolve, reject) => {
      for (const sensorLocation of cityForLocation) {
        const location = sensorLocation[1]
        countryList[location.country] = countryList[location.country] || []
        countryList[location.country].push(sensorLocation[0])
      }
      const countryListJSON = {
        name: 'sensorlocationIds per country',
        description: 'List of sensorlocation id\'s per country',
        source: 'http://api.luftdaten.info/static/v2/data.json',
        origin: 'https://data.influencair.be/countryList.json',
        author: 'Toon Nelissen',
        documentation: 'https://docs.influencair.be',
        timestamp: (new Date()).toJSON(),
        data: countryList
      }
      try {
        fs.outputJson(path.join(staticDirectoryPath, 'countryList.json'), countryListJSON, (err) => {
          if (err) throw err
          console.log('The file countryList.json, has been saved!')
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
                console.log('No response from geocoder', response, sensorLocation)
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
  updateLocations () {
    return new Promise(async (resolve, reject) => {
      let fetchLimit = 20
      let fetchCounter = 0
      const now = new Date()
      if (this.updatingLocations) return
      this.updatingLocations = true
      // loop over this data
      for (const sensorLocation of this.data) {
        const sensors = sensorLocation.sensors.reduce((acc, sensor) => {
          acc.push(sensor.id)
          return acc
        }, [])
        if (!this.locations.has(sensorLocation.id) || typeof this.locations.get(sensorLocation.id) === 'string') {
          try {
            if (~~sensorLocation.latitude && ~~sensorLocation.longitude) {
              const response = (await got(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&lat=${sensorLocation.latitude}&lon=${sensorLocation.longitude}&accept-language=en`, { json: true })).body
              if (response) {
                this.locations.set(sensorLocation.id, {
                  lastSeenDate: now,
                  location: response,
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
          const sensorlocationFromMap = this.locations.get(sensorLocation.id)
          sensorlocationFromMap.lastSeenDate = now
          sensorlocationFromMap.sensors = sensors
          this.locations.set(sensorLocation.id, sensorlocationFromMap)
        }

        if (fetchCounter >= fetchLimit) break
      }
      const locationsPath = path.join(storageDirectoryPath, 'locations.json')
      try {
        fs.outputJson(locationsPath, [...this.locations], (err) => {
          if (err) throw err
          console.log('The file locations.json, has been saved! With ' + this.locations.size + 'records')
        })
      } catch (error) {
        reject(error)
      }
      this.updatingLocations = false
      resolve()
    })
  }
  updateSensorLocationsData () {
    return new Promise((resolve, reject) => {
      const sensorLocationsPath = path.join(storageDirectoryPath, 'sensorLocations.json')
      try {
        fs.outputJson(sensorLocationsPath, [...this.sensorLocations], (err) => {
          if (err) throw err
          console.log('The file sensorLocations.json, has been saved! With ' + this.cityForLocation.size + 'records')
        })
      } catch (error) {
        reject(error)
      }
    })
  }
  calculateRankings () {
    const DAY = 1000 * 60 * 60 * 24
    const aDayAgo = Date.now() - DAY

    const citiesArray = []
    const countriesArray = []
    const locations = [...this.locations.values()]
    const addressProperties = ['ciyt', 'town', 'village', 'county', 'suburb', 'hamlet']
    const nameCorrection = {
      'Sofia City': 'Sofia',
      'Brussels-Capital': 'Brussels'
    }

    const cityRanking = locations.reduce((acc, { lastSeenDate, location }) => {
      // only count the sensors seen the last day
      if (!lastSeenDate || (lastSeenDate && Date.parse(lastSeenDate) < aDayAgo)) return acc
      const countryName = location.address.country

      const country = acc[countryName] || { name: countryName, amount: 0, cities: {} }
      for (const loc in location.address) {
        if (location.address.hasOwnProperty(loc)) {
          if (addressProperties.includes(loc)) {
            const locName = nameCorrection[location.address[loc]] || location.address[loc]
            const city = country.cities[locName] || { name: locName, amount: 0, type: loc }
            city.amount = city.amount + 1
            country.cities[locName] = city
          }
        }
      }
      country.amount = country.amount + 1
      acc[countryName] = country
      return acc
    }, {})

    for (const countryName in cityRanking) {
      const country = cityRanking[countryName]
      for (const cityName in country.cities) {
        const city = country.cities[cityName]
        city.country = countryName
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
      documentation: 'https://docs.influencair.be',
      timestamp: (new Date()).toJSON(),
      data: citiesArray
    }

    fs.outputJson(path.join(staticRankingDirectoryPath, 'cityRanking.json'), cityRankingJSON, { spaces: 2 }, (err) => {
      if (err) throw err
      console.log('The file cityRanking.json, has been saved!')
    })

    const countryRankingJSON = {
      name: 'country ranking amount of luftdaten sensors last 24h',
      description: 'This ranking is composed from querying the source every 3 minutes and keeping track of all the unique sensor locations. The ranking only includes sensors seen for the last 24 hours',
      source: 'http://api.luftdaten.info/static/v2/data.json',
      origin: 'https://data.influencair.be/ranking/countryRanking.json',
      author: 'Toon Nelissen',
      documentation: 'https://docs.influencair.be',
      timestamp: (new Date()).toJSON(),
      data: countriesArray
    }

    fs.outputJson(path.join(staticRankingDirectoryPath, 'countryRanking.json'), countryRankingJSON, { spaces: 2 }, (err) => {
      if (err) throw err
      console.log('The file countryRanking.json, has been saved!')
    })

    const worldRankingJSON = {
      name: 'total amount of luftdaten sensors seen last 24h',
      description: 'This ranking is composed from querying the source every 3 minutes and keeping track of all the unique sensor locations. The ranking only includes sensors seen for the last 24 hours',
      source: 'http://api.luftdaten.info/static/v2/data.json',
      origin: 'https://data.influencair.be/ranking/worldRanking.json',
      author: 'Toon Nelissen',
      documentation: 'https://docs.influencair.be',
      timestamp: (new Date()).toJSON(),
      data: worldArray
    }

    fs.outputJson(path.join(staticRankingDirectoryPath, 'worldRanking.json'), worldRankingJSON, { spaces: 2 }, (err) => {
      if (err) throw err
      console.log('The file worldRanking.json, has been saved!')
    })
  }
}
module.exports = Luftdaten
