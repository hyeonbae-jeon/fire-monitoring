FROM node:24-bookworm-slim AS web
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /build
COPY global.json ./
COPY bridge/ ./bridge/
RUN dotnet publish bridge/WisenetPtzBridge -c Release --self-contained false -o /out --nologo
COPY --from=web /build/web/dist /out/wwwroot

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /data && chown "$APP_UID" /data
USER $APP_UID
ENV MONITOR_SERVER_MODE=true MONITOR_LISTEN_ADDRESS=0.0.0.0 MONITOR_PORT=5080 CCTV_DATA_DIR=/data
EXPOSE 5080
ENTRYPOINT ["dotnet", "WisenetPtzBridge.dll"]
