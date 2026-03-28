# Map Animator

A Cesium-based flight path animator.

## Local Development

```bash
npm install
cp .env.example .env   # fill in CESIUM_ION_TOKEN and MAPTILER_API_KEY
npm start
```

App runs at `http://127.0.0.1:3003`.

## Deployment (DigitalOcean)

**Live at:** `https://map.ritsher.video`

### First Deploy

SSH into the droplet and run:

```bash
cd /opt && git clone git@github.com:dritsher/map-animator.git
cd map-animator
npm install
cp .env.example .env
nano .env   # fill in CESIUM_ION_TOKEN and MAPTILER_API_KEY
pm2 start npm --name "map-animator" -- start
pm2 save
```

### Updating

```bash
ssh root@test.ritsher.video
cd /opt/map-animator
git pull
npm install   # only needed if dependencies changed
pm2 restart map-animator
```

### Nginx Config

`/etc/nginx/sites-available/map-animator`:

```nginx
server {
    listen 80;
    server_name map.ritsher.video;

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 30m;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/map-animator /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
certbot --nginx -d map.ritsher.video
```

### DNS

An **A record** for `map` pointing to the droplet IP must exist in the DigitalOcean DNS panel under `ritsher.video` (Networking → Domains).
