#! /usr/local/bin/node

const fs = require("fs")
const exec = require("child_process").exec
const recursiveReadSync = require("recursive-readdir-sync")
const jtree = require("jtree")
const TreeNode = jtree.TreeNode
const BrowserScript = jtree.Utils.BrowserScript

const ProjectProgram = jtree.getLanguage("project")

const outputFile = __dirname + `/../ignore/lime.browser.ts`

const files = recursiveReadSync(__dirname + "/../src").filter(file => file.includes(".ts"))
const projectCode = new TreeNode(ProjectProgram.getProjectProgram(files))
projectCode
  .getTopDownArray()
  .filter(n => n.getKeyword() === "relative")
  .forEach(node => node.setLine(node.getLine() + ".ts"))
fs.writeFileSync(__dirname + "/../ignore/lime.project", projectCode.toString(), "utf8")
const projectProgram = new ProjectProgram(projectCode.toString())
const scripts = projectProgram.getOrderedDependenciesArray().filter(file => !file.includes(".node."))

const combined = scripts
  .map(src => fs.readFileSync(src, "utf8"))
  .map(content =>
    new BrowserScript(content)
      .removeRequires()
      .removeImports()
      .removeExports()
      .getString()
  )
  .join("\n")
  .replace(/\/\/ window\./g, "window.")
  .replace(/export.+/g, "")

fs.writeFileSync(outputFile, `"use strict"\n` + combined, "utf8")
exec("tsc -p tsconfig.browser.json")
