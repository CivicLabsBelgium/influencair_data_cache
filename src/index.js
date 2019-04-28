const express = require('express')
const path = require('path')
const serveStatic = require('serve-static')
const serveIndex = require('serve-index')
const dataCruncher = require('./dataCruncher')

const app = express()
const port = 8080

// const irceline = new Irceline()
// new Luftdaten()

dataCruncher()

app.use(serveStatic(path.join(__dirname, '..', 'static'), {
    index: false
}))
app.use(serveIndex(path.join(__dirname, '..', 'static'), {
    icons: true
}))

app.listen(port, () => console.log(`Listening on port ${port}!`))
