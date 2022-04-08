// const { Octokit } = require("octokit");

// const octokit = new Octokit({
//   userAgent: "my-app/v1.2.3",
// });

// const REGISTRY_DIR = "token-registry"
// const VALID_FILES = [
//   "logo.png",
//   "token.json",
//   "logo-large.png",
//   "logo.svg",
//   "testnet.token.json"
// ]

// const REQUIRED_FILES = [
//   "logo.png", 
//   "token.json"
// ]

// async function runTest() {
//   const client = getOctokit()
//   const owner = "LanfordCai"
//   const repo = "flow-token-list"
//   const prNumber = 2
//   const files = pullFiles(client, owner, repo, prNumber) 
// }

// main()

// async function main() {
//   const resp = await pullFiles("LanfordCai", "flow-token-list", 2)
//   if (resp.status != 200) {
//     console.log("fetch files failed")
//     return
//   }
//   const files = resp.data
//   try {
//     validateFiles(files)
//   } catch (e) {
//     // console.log(e)
//   }
// }

// function addNewTokenCheck(files) {
//   let hasLogo = false
//   let hasTokenJson = false
//   for (var i = 0; i < files.length; i++) {
//     const file = files[i]
//     if (file.status != "added") {
//       throw new Error("only add new file is allowed in a NewToken PR")
//     }
//     const [registryDir, tokenSymbol, filename] = file.filename.split("/") 
//     if (!VALID_FILES.includes(filename)) {
//       throw new Error("contains invalid file")
//     }
//     if (filename == "logo.png") {
//       hasLogo = true
//     }
//     if (filename == "token.json") {
//       hasTokenJson = true
//     }
//   }

//   if (!(hasLogo && hasTokenJson)) {
//     throw new Error("logo.png and token.json is required")
//   }
// }

// function updateTokenCheck(files) {
//   for (var i = 0; i < files.length; i++) {
//     const file = files[i]
//     const [registryDir, tokenSymbol, filename] = file.filename.split("/") 
//     if (!VALID_FILES.includes(filename)) {
//       throw new Error("contains invalid file")
//     } 
//     if (file.status == "added" && (filename == "logo.png" || filename == "token.json")) {
//       throw new Error("seems add new token rather than update token")
//     }
//   }
// }

// function validateFiles(files) {
//   let symbol = null
//   if (files.length > 5 || files.length == 0) { 
//     throw new Error("invalid files count") 
//   }
//   for (var i = 0; i < files.length; i++) {
//     const file = files[i]
//     const [registryDir, tokenSymbol, filename] = file.filename.split("/")
//     if (registryDir != REGISTRY_DIR) { 
//       throw new Error(`changes happened out of ${REGISTRY_DIR}`) 
//     }
//     if (tokenSymbol.trim() == "") { 
//       throw new Error(`invalid tokenSymbol ${tokenSymbol}`) 
//     }
//     if (!symbol) {
//       symbol = tokenSymbol
//     }
//     if (symbol != tokenSymbol) {
//       throw new Error(`more than one token changed! ${symbol} && ${tokenSymbol}`)
//     }
//   }
// }

// async function pullFiles(owner, repo, pullNumber) {
//   console.log(owner)
//   return await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
//     owner: owner,
//     repo: repo,
//     pull_number: pullNumber
//   })
// }
