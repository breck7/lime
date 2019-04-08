#!/usr/bin/env ts-node

const jtree = require("jtree")
const cheerio = require("cheerio")
const fs = require("fs")
const tap = require("tap")
const read = path => fs.readFileSync(path, "utf8")

const LimeConstructor = jtree.getProgramConstructor(__dirname + "/../lime.grammar")

const save = (name: string, results: string) => {
  const filename = __dirname + `/../ignore/testOutput/${name}.html`
  fs.writeFileSync(filename, results, "utf8")
  return filename
}

const testTree: any = {}
testTree._runOnly = []

testTree.heredoc = (equal, isColor) => {
  const grammar = `name PHP
global_scope black
contexts
 main
  match <?php
   scope orange
  match <<<([A-Za-z][A-Za-z0-9_]*)
   push heredoc
 heredoc
  meta_scope gray
  match ^\\1;
   pop true`

  const code = `<?php

$foo = <<<DOG
  This is a dog
  He is yellow.
  DOG;
DOG;`

  const expected = `line
 span <?php
  scopes orange
line
 span
  scopes black
line
 span $foo =
  scopes black
 span <<<DOG
  scopes black gray
line
 span   This is a dog
  scopes black gray
line
 span   He is yellow.
  scopes black gray
line
 span   DOG;
  scopes black gray
line
 span DOG;
  scopes black gray`

  const program = new LimeConstructor(grammar)
  program.verbose = false
  const results = program.execute(code)

  const errs = program.getProgramErrors()
  equal(errs.length, 0, "no errors")

  save("heredoc", program.toHtml(results))
}

testTree.grammarError = equal => {
  const grammar = `version 2.1
name dag
file_extensions dag
global_2scope source.dag
contexts
 main
  match \\d+
   scopde blue
  include tiles
 tiles
  match a
   scope green`

  const program = new LimeConstructor(grammar)
  program.verbose = false

  const errs = program.getProgramErrors()
  equal(errs.length, 2, "2 errors")
}

testTree.metaScope = (equal, isColor) => {
  const program = new LimeConstructor(
    read("/Users/breck/Library/Application Support/Sublime Text 3/Packages/TreeNotation/lime/tests/c.lime")
  )
  program.verbose = false

  const results = program.execute(`if "test"`)

  const html = program.toHtml(results)

  isColor(html, "if", "green")
  isColor(html, "test", "blue")
  isColor(html, '"', "blue")
}

testTree.metaContentScope = (equal, isColor) => {
  const program = new LimeConstructor(
    `global_scope source._gray
contexts
 main
  match \\b(if)\\b
   scope keyword.control.c._green
  match "
   push string
 string
  meta_content_scope string.quoted.double.c._blue
  match "
   pop true`
  )
  program.verbose = false

  const results = program.execute(`if "test"`)

  const html = program.toHtml(results)

  isColor(html, "if", "green")
  isColor(html, "test", "blue")
  isColor(html, '"', "gray")
}

testTree.digits = (equal, isColor) => {
  const grammar = `version 2.1
name dag
file_extensions dag
global_scope source.dag
contexts
 main
  match \\d+
   scope blue
  match \\+
   scope orange
  match \\w+
   scope green
  match ;
   scope red`

  const program = new LimeConstructor(grammar)
  program.verbose = false

  const errs = program.getProgramErrors()
  equal(errs.length, 0, "no errors")

  const results = program.execute(`1 + 1;
  23 + 232;;
  2++2;zaaa

  23`)

  const html = program.toHtml(results)
  save("digits", html)

  isColor(html, "23", "blue")
  isColor(html, "+", "orange")
  isColor(html, ";", "red")
  isColor(html, "zaaa", "green")
}

testTree.flow = (equal, isColor) => {
  const grammar = read(__dirname + "/flow.lime")

  const program = new LimeConstructor(grammar)
  program.verbose = false

  const errs = program.getProgramErrors()
  equal(errs.length, 0, "no errors")

  let html = program.toHtml(program.execute(read(__dirname + "/sample.flow")))
  save("flow", html)

  isColor(html, "sam", "red")
  isColor(html, "views.list>", "purple")
  isColor(html, "goog.pie>", "purple")
  isColor(html, "77", "aqua")
  isColor(html, "Hello", "gray")

  html = program.toHtml(
    program.execute(`tables.basic>
 title Foobar
  apply.filter>`)
  )
  isColor(html, "apply.filter>", "red")
}

const runTests = testTree => {
  const testsToRun = testTree._runOnly.length
    ? testTree._runOnly
    : Object.keys(testTree).filter(key => !key.startsWith("_"))
  testsToRun.forEach(key => {
    tap.test(key, function(childTest) {
      const testCase = testTree[key](childTest.equal, (html, text, color) => {
        let el = cheerio.load(html)(`span:contains('${text}')`)
        if (!el.length) childTest.equal(false, true, `No ${text} found`)
        else childTest.equal(el.css("color"), color, text)
      })
      childTest.end()
    })
  })
}

runTests(testTree)
