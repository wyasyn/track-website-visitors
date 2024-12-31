# Use the official Node.js 18 image as a base
FROM node:18

# Set the working directory inside the container
WORKDIR /app

# Copy only package.json and pnpm-lock.yaml first to leverage Docker cache for dependencies
COPY package.json pnpm-lock.yaml ./

# Install pnpm globally and install dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy the rest of the application files
COPY . .

# Expose port 8000 for the application
EXPOSE 8000

# Start the application using pnpm
CMD ["pnpm", "start"]
