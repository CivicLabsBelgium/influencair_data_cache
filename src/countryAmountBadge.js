const fs = require('fs-extra')
const text2png = require('text2png')
const path = require('path')

const countryRankingPath = path.join(__dirname, '..', 'static', 'ranking', 'countryRanking.json')

const getcountryRanking = (country) => {
  return new Promise((resolve, reject) => {
    fs.readJSON(countryRankingPath).then(obj => {
      if (obj.data) {
        const countryObject = obj.data.find(c => c.name.toLowerCase() === country.toLowerCase())
        console.log(countryObject)
        return resolve(countryObject)
      }
      return reject(new Error('no countryranking file'))
    }).catch(err => {
      console.error(err)
      return reject(err)
    })
  })
}

const countryAmountBadge = async (req, res) => {
  if (req.params.countryname) {
    const text2pngOptions = { padding: 2 }
    text2pngOptions.textColor = req.query.color || 'black'
    text2pngOptions.bgColor = req.query.bgColor || 'transparent'
    const fontSize = req.query.fontSize || 20
    const font = req.query.font || 'Gill Sans'
    text2pngOptions.font = `${fontSize}px ${font}`
    const countryName = req.params.countryname.split('.')[0]
    const preText = req.query.pre ? req.query.pre + ' ' : ''
    const postText = req.query.post ? ' ' + req.query.post : ''
    const country = await getcountryRanking(countryName)
    if (country) {
      const file = text2png(preText + country.amount + postText, text2pngOptions)
      res.send(file)
    } else {
      res.sendStatus(404)
    }
  } else {
    res.sendStatus(404)
  }
}

module.exports = countryAmountBadge
