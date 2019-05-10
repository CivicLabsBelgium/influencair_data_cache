const fs = require('fs-extra')
const text2png = require('text2png')
const path = require('path')

const cityDirectoryPath = path.join(__dirname, '..', 'static', 'badge', 'amount', 'city')
const cityRankingPath = path.join(__dirname, '..', 'static', 'ranking', 'cityRanking.json')

const getCityRanking = (city) => {
    return new Promise((resolve, reject) => {
        fs.readJSON(cityRankingPath).then(obj => {
            if (obj.data) {
                const cityObject = obj.data.find(c => c.name.toLowerCase() === city.toLowerCase())
                console.log(cityObject)
                return resolve(cityObject)
            }
            return reject(new Error('no cityranking file'))
        }).catch(err => {
            console.error(err)
            return reject(err)
        })
    })
}

const cityAmountBadge = async (req, res) => {
    if (req.params.cityname) {
        const text2pngOptions = { padding: 2 }
        text2pngOptions.color = req.query.color || 'black'
        text2pngOptions.backgroundColor = req.query.bgColor || 'transparant'
        const fontSize = req.query.fontSize || 20
        const font = req.query.font || 'Gill Sans'
        text2pngOptions.font = `${fontSize}px ${font}`
        const cityName = req.params.cityname.split('.')[0]
        const preText = req.query.pre ? req.query.pre + ' ' : ''
        const postText = req.query.post ? ' ' + req.query.post : ''
        console.log(preText, postText)
        // const filePath = path.join(cityDirectoryPath, cityName + '.png')
        const city = await getCityRanking(cityName)
        const file = text2png(preText + city.amount + postText, text2pngOptions)
        res.send(file)
    } else {
        res.sendStatus(404)
    }
}

module.exports = cityAmountBadge
