const express = require('express')
const path = require('path')
const serveStatic = require('serve-static')
const serveIndex = require('serve-index')
const dataCruncher = require('./dataCruncher')
const sanitizeRequest = require('express-sanitize-middleware')

const app = express()
const port = 8080

dataCruncher()

app.get('/badge/amount/city/:cityname', sanitizeRequest({ params: true, query: true }), require('./cityAmountBadge'))

app.use(serveStatic(path.join(__dirname, '..', 'static'), {
    index: false
}))

app.use(serveIndex(path.join(__dirname, '..', 'static'), {
    icons: true
}))

app.listen(port, () => console.log(`Listening on port ${port}!`))
