# SSP Key v2.3.1

_Release date: 27 November 2026_

SSP Key 2.3.1 fixes the amount shown when you send coins to your own address. It works with SSP Wallet 2.3.0, so there's no wallet update this time.

On Bitcoin, Litecoin, Flux, Dogecoin, Ravencoin, Bitcoin Cash and Zcash, a send to your own address pays the amount and the leftover change to the same address. Since 2.2.0 the approval screen added the two together, so sending 1000 FLUX could read "Send 1006.8 FLUX". It now shows the amount you entered, and the recipient is labelled "To your own wallet". This was a display problem only. Every output of such a transaction goes back to your own address, and only the network fee leaves the wallet.

Advanced now has an "Inputs and outputs" section on every send on those chains:

- how many inputs the transaction spends, and their total
- the amount sent
- the change going back to the same address
- the network fee

Community translations for 38 languages were updated too.
