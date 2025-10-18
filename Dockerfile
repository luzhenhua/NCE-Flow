FROM python:3-slim
WORKDIR /app
COPY . .
EXPOSE 6452
CMD ["python", "-m", "http.server", "6452"]
