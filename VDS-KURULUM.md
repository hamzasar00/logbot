# Logbot V4 - VDS Kurulumu

Bu rehber Ubuntu 22.04 veya 24.04 kullanan bir VDS icindir.

## 1. Sistem paketleri

~~~bash
sudo apt update
sudo apt install -y git curl
~~~

## 2. Node.js ve PM2

~~~bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
~~~

Node.js surumunu kontrol edin:

~~~bash
node --version
npm --version
~~~

## 3. Projeyi V4 branch'i ile indir

~~~bash
git clone -b V4 https://github.com/hamzasar00/logbot.git
cd logbot
~~~

## 4. Gizli ayarlari VDS uzerinde olustur

Tokeni GitHub'a koymayin. Sadece VDS icinde .env dosyasi olusturun:

~~~bash
cp .env.example .env
nano .env
~~~

.env icine Discord bot tokeni, client ID ve guild ID bilgilerini girin.

## 5. Ilk bagimlilik kurulumu ve baslatma

~~~bash
npm ci --no-audit --no-fund
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
~~~

pm2 startup komutunun yazdirdigi sudo komutunu aynen bir kez calistirin. Bu, VDS yeniden basladiginda botun otomatik acilmasini saglar.

## 6. Durum ve log kontrolu

~~~bash
pm2 status
pm2 logs logbot
~~~

## 7. Yeni surumu guncelleme

VDS'de proje klasorunde su komut yeterlidir:

~~~bash
cd ~/logbot
bash deploy-vds.sh
~~~

Script sadece yeni GitHub commitlerini alir. package.json veya package-lock.json degismediyse npm kurulumu yapmaz. Sonra PM2 botu kesintisiz reload eder.

## Onemli

- Discord tokenini GitHub'a veya bu repoya yuklemeyin.
- Bot icin View Audit Log, View Channel, Send Messages ve Embed Links izinlerini verin.
- VDS kapatilirsa veya internet kesilirse bot da baglantiyi kaybeder; PM2 baglanti geri geldiginde sureci ayakta tutar.
