FROM golang:alpine AS build

WORKDIR /app
COPY gilts-go .

RUN mkdir -p dist && \
    go build -o dist/main lambda/collect-data/main.go

FROM public.ecr.aws/lambda/provided:al2023

COPY --from=build /app/dist/main ./main

ENTRYPOINT [ "./main" ]
