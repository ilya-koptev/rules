# webui-dashboards

[`make_dashboard.py`](make_dashboard.py) собирает дашборды штатного веб-интерфейса,
чтобы их состав лежал в репозитории, а не только на контроллере.

## Применить

```bash
python3 make_dashboard.py
scp <результат> root@<контроллер>:/tmp/
ssh root@<контроллер> 'systemctl restart wb-homeui-backend'
```

Конфиг веб-интерфейса перед правкой бэкапится.
