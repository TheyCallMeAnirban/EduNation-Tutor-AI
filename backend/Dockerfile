FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY main.py .

# Create cache directory
RUN mkdir -p cache

EXPOSE 8000

CMD ["python", "main.py"]
