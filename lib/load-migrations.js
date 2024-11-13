'use strict'

const path = require('path')
const fs = require('fs').promises
const url = require('node:url')
const Migration = require('./migration')

module.exports = loadMigrationsIntoSet

async function loadMigrationsIntoSet(options, fn) {
  // Process options, set and store are required, rest optional
  const opts = options || {}
  if (!opts.set || !opts.store) {
    throw new TypeError((opts.set ? 'store' : 'set') + ' is required for loading migrations')
  }
  const set = opts.set
  const store = opts.store
  const ignoreMissing = !!opts.ignoreMissing
  const migrationsDirectory = path.resolve(opts.migrationsDirectory || 'migrations')
  const filterFn = opts.filterFunction || (() => true)
  const sortFn = opts.sortFunction || function (m1, m2) {
    return m1.title > m2.title ? 1 : (m1.title < m2.title ? -1 : 0)
  }

  try {
    // Load from migrations store first up
    const state = await new Promise((resolve, reject) => {
      store.load(function (err, state) {
        if (err) return reject(err)
        resolve(state)
      })
    })

    // Set last run date on the set
    set.lastRun = state.lastRun || null

    // Read migrations directory
    let files = await fs.readdir(migrationsDirectory)

    // Filter out non-matching files
    files = files.filter(filterFn)

    // Create migrations, keep a lookup map for the next step
    const migMap = {}
    const promises = files.map(async function (file) {
      // Try to load the migrations file
      const filepath = path.join(migrationsDirectory, file)
      let mod
      try {
        mod = require(filepath)
      } catch (e) {
        if (e.code === 'ERR_REQUIRE_ESM') {
          mod = await import(url.pathToFileURL(filepath))
        } else {
          throw e
        }
      }

      const migration = new Migration(file, mod.up, mod.down, mod.description)
      migMap[file] = migration
      return migration
    })
    let migrations = await Promise.all(promises)

    // Fill in timestamp from state, or error if missing
    if (state.migrations) {
      for (const m of state.migrations) {
        // Check if migration file exists
        const migrationFilePath = path.join(migrationsDirectory, m.title + '.js') // Modify this path based on your actual directory structure

        try {
          await fs.access(migrationFilePath)  // Check if the file exists asynchronously
        } catch (e) {
          if (ignoreMissing) {
            // Skip migrations with missing files if ignoreMissing is true
            continue
          } else {
            return fn(new Error('Missing migration file: ' + m.title))  // Throw an error if the migration file is missing and ignoreMissing is false
          }
        }

        // If migration exists in state, update its timestamp
        if (migMap[m.title]) {
          migMap[m.title].timestamp = m.timestamp
        }
      }
    }

    // Sort the migrations by their title
    migrations = migrations.sort(sortFn)

    // Add the migrations to the set
    migrations.forEach(set.addMigration.bind(set))

    // Successfully loaded
    fn()

  } catch (e) {
    fn(e)
  }
}
