const request = require('request')

class Irceline {
  constructor () {
    this.ircelinePhenomenonIndex = {
      'PM10': 5,
      'PM25': 6001,
      'temperature': 62101
    }
    this.data = []
    this.stations = []

    this.getData = this.getData.bind(this)

    setInterval(this.getData, 1000 * 60 * 5)
    this.getStations()
  }
  async getStations () {
    let ircelinePm10Url = `https://geo.irceline.be/sos/api/v1/stations?phenomenon=${this.ircelinePhenomenonIndex.PM10}`
    let ircelinePm25Url = `https://geo.irceline.be/sos/api/v1/stations?phenomenon=${this.ircelinePhenomenonIndex.PM25}`
    let ircelineTempUrl = `https://geo.irceline.be/sos/api/v1/stations?phenomenon=${this.ircelinePhenomenonIndex.temperature}`

    let ircelinePm10Json = new Promise((resolve, reject) => request.get({ url: ircelinePm10Url, json: true }, (error, response, body) => {
      if (error) reject(error)
      resolve(body)
    }))
    let ircelinePm25Json = new Promise((resolve, reject) => request.get({ url: ircelinePm25Url, json: true }, (error, response, body) => {
      if (error) reject(error)
      resolve(body)
    }))
    let ircelineTempJson = new Promise((resolve, reject) => request.get({ url: ircelineTempUrl, json: true }, (error, response, body) => {
      if (error) reject(error)
      resolve(body)
    }))

    const stationsResult = await Promise.all([ircelinePm10Json, ircelinePm25Json, ircelineTempJson])
    this.stations = [].concat.apply([], stationsResult)
    console.log('got irceline stations', new Date())
  }
  getData () {
    return new Promise(async (resolve, reject) => {
      if (this.stations.length === 0) {
        console.error(`Irceline --> getData ERROR: no stations`)
        return reject(new Error(`Irceline --> getData ERROR: no stations`))
      }

      let dataArray = this.stations.map(async (station) => {
        let pm10RequestUrl = 'https://geo.irceline.be/sos/api/v1/timeseries?expanded=true&station=' + station.properties.id + '&phenomenon=5&force_latest_values=true'
        let pm25RequestUrl = 'https://geo.irceline.be/sos/api/v1/timeseries?expanded=true&station=' + station.properties.id + '&phenomenon=6001&force_latest_values=true'
        let tempRequestUrl = 'https://geo.irceline.be/sos/api/v1/timeseries?expanded=true&station=' + station.properties.id + '&phenomenon=62101&force_latest_values=true'

        let ircelineData = await (async () => {
          let pm10Request, pm25Request, tempRequest
          try {
            pm10Request = await (() => new Promise((resolve, reject) => request.get({ url: pm10RequestUrl, json: true }, (error, response, body) => {
              if (error) reject(error)
              resolve(body)
            })))() || []
            pm25Request = await (() => new Promise((resolve, reject) => request.get({ url: pm25RequestUrl, json: true }, (error, response, body) => {
              if (error) reject(error)
              resolve(body)
            })))() || []
            tempRequest = await (() => new Promise((resolve, reject) => request.get({ url: tempRequestUrl, json: true }, (error, response, body) => {
              if (error) reject(error)
              resolve(body)
            })))() || []
          } catch (err) {
            console.warn('invalid irceline data', err)
            reject(err)
          }
          let pm10Response = pm10Request[0] || false
          let pm25Response = pm25Request[0] || false
          let tempResponse = tempRequest[0] || false
          return [pm10Response, pm25Response, tempResponse]
        })().then(data => data).catch(error => reject(error))

        let pm10Response = ircelineData[0]
        let pm25Response = ircelineData[1]
        let tempResponse = ircelineData[2]

        let sensorID = (pm10Response) ? pm10Response.id : (pm25Response) ? pm25Response.id : (tempResponse) ? tempResponse.id : null
        let sensorName = (pm10Response) ? pm10Response.parameters.procedure.label : (pm25Response) ? pm25Response.parameters.procedure.label : (tempResponse) ? tempResponse.parameters.procedure.label : null

        if (sensorID === null || sensorName === null) return false

        sensorName = sensorName.split(' - ')[1].split(';')[0]
        let PM10 = (pm10Response && pm10Response.lastValue.value >= 0) ? pm10Response.lastValue.value : null
        let PM25 = (pm25Response && pm25Response.lastValue.value >= 0) ? pm25Response.lastValue.value : null
        let temp = (tempResponse && tempResponse.lastValue.value >= 0) ? tempResponse.lastValue.value : null

        /// Splitting sensor into PM or temperature sensor
        let PMObject = (pm10Response || pm25Response) ? {
          id: 'I-' + sensorID + 'p',
          manufacturer: null,
          name: sensorName,
          PM10: PM10,
          PM25: PM25,
          stationID: 'I-' + station.properties.id
        } : null

        let tempObject = (tempResponse) ? {
          id: 'I-' + sensorID + 't',
          manufacturer: null,
          name: sensorName,
          temperature: temp,
          stationID: 'I-' + station.properties.id
        } : null

        let sensors = [
          PMObject,
          tempObject
        ].filter(
          (sensor) => {
            return sensor !== null
          }
        )

        return {
          id: 'I-' + station.properties.id,
          latitude: station.geometry.coordinates[1],
          longitude: station.geometry.coordinates[0],
          origin: 'irceline',
          sensors: sensors
        }
      })

      // reduce data array to collection of valid dataSets, filter out invalid API returns
      // filter out duplicates
      dataArray = await Promise.all(dataArray)

      dataArray = dataArray.reduce(
        (accumulator, station) => {
          if (station) {
            let duplicate = accumulator.find(stationDuplicateCheck => stationDuplicateCheck.id === station.id)

            if (!duplicate) {
              accumulator.push(station)
            }
          }

          return accumulator
        },
        []
      )

      this.data = dataArray
      console.log('got irceline data', new Date())
      resolve()
    })
  }
}

module.exports = Irceline
