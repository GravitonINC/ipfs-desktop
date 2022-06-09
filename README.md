# NFT storage  Web UI, desktop app 

Build steps from webui to desktop app

Install all packages
```console
$ yarn
```
build web ui
```console
$ yarn build
```
Once built, above command will run after-build.js automatically.
This script copy/paste build folder at nft-storage-webui to nft-storage-desktop/assets/webui.
If you don't have these 2 project folders at same folder, this script will be failed and you must copy paste and rename folder to webui manually.

Once webui build folder is pasted and renamed as /asset/webui ,  you can build nft-storage desktop app.

```console
$ yarn build
```
to package
```console
$ yarn package
```
