/* GOAL
    Orchestrate data consumation of all data entries
    Prepare all data to json files
*/

const Irceline = require('./irceline')
const irceline = new Irceline()
const Luftdaten = require('./luftdaten')
const luftdaten = new Luftdaten()

// STEP 1 Get data
// run every minute
// If all processes are done
//  get Luftdaten always
//  get luftdaten means every 30min
//  get Irceline every 5min
// When done fetching data Run STEP 2

// STEP 2 Transform data
// when done transforming data Run STEP 3

// StEP 3 Save data

module.exports = () => {
    setInterval(() => getData(), 1000 * 60)
    getData()
}

const getList = [
    {
        getData: luftdaten.getCurrentData,
        interval: 1000 * 60,
        lastRun: Date.now() - 1000 * 60,
        transFormer: luftdaten.parseCurrentData,
        dataSaver: [
            luftdaten.createStaticJsonFiles,
            luftdaten.updateCityData,
            luftdaten.calculateRankings,
            luftdaten.createSensorsPerCity,
            luftdaten.createSensorsPerCountry
        ]
    },
    {
        getData: luftdaten.getMeans,
        interval: 1000 * 60 * 30,
        lastRun: Date.now() - 1000 * 60 * 30,
        transFormer: luftdaten.parseCurrentData,
        dataSaver: luftdaten.createStaticJsonFiles
    },
    {
        getData: irceline.getData,
        interval: 1000 * 60 * 5,
        lastRun: Date.now() - 1000 * 60 * 5
    }
]

const getData = () => {
    getList.forEach(async (dataGetter, i) => {
        try {
            if (dataGetter.lastRun + dataGetter.interval < Date.now()) {
                await dataGetter.getData()
                if (dataGetter.transFormer) await dataGetter.transFormer()
                if (dataGetter.dataSaver) {
                    if (typeof dataGetter.dataSaver === 'function') await dataGetter.dataSaver
                    if (Array.isArray(dataGetter.dataSaver)) {
                        dataGetter.dataSaver.forEach(async dataSaver => {
                            await dataSaver()
                        })
                    }
                }
                getList[i].lastRun = Date.now()
            }
        } catch (error) {
            console.error(error)
        }
    })
}
