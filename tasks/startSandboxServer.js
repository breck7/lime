#! /usr/local/bin/node

const express = require("express")
const app = express()

app.use(express.static(__dirname + "/../"))

const port = 7777
app.listen(port, () => {
  console.log(`Running sandbox. cmd+dblclick: http://localhost:${port}/sandbox`)
})
