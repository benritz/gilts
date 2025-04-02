import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';

import { Construct } from 'constructs';

type WebAppProps = {
  dataBucket: s3.Bucket
}

export class WebApp extends Construct {
  dataBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: WebAppProps) {
    super(scope, id)

    const { 
      dataBucket
    } = props

    const webAppBucket = new s3.Bucket(this, 'WebAppBucket', {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const accessIdentity = new cloudfront.OriginAccessIdentity(this, 'CloudfrontAccess')

    const webAppAccessPolicy = new iam.PolicyStatement();
    webAppAccessPolicy.addActions('s3:GetObject');
    webAppAccessPolicy.addPrincipals(accessIdentity.grantPrincipal);
    webAppAccessPolicy.addResources(webAppBucket.arnForObjects('*'));
    webAppBucket.addToResourcePolicy(webAppAccessPolicy);    

    const dataAccessPolicy = new iam.PolicyStatement()
    dataAccessPolicy.addActions('s3:GetObject')
    dataAccessPolicy.addPrincipals(accessIdentity.grantPrincipal)
    dataAccessPolicy.addResources(dataBucket.arnForObjects('*'))
    dataBucket.addToResourcePolicy(dataAccessPolicy)

    const webAppOrigin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(webAppBucket, { originId: 'webAppOrigin' })
    const dataOrigin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(dataBucket, { originId: 'dataOrigin' })

    const dist = new cloudfront.Distribution(this, 'distribution', {
      defaultBehavior: {
          origin: webAppOrigin,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      additionalBehaviors: {
        'data/*': {
          origin: dataOrigin,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
        }
      },
      // domainNames: [domainName],
      sslSupportMethod: cloudfront.SSLMethod.SNI,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // certificate,
      comment: 'Gilts Web App',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      // logBucket,
      // errorResponses: [ {
      //         httpStatus: 403,
      //         responseHttpStatus: 404,
      //         responsePagePath: '/404.html',
      //         ttl: cdk.Duration.minutes(5)
      //     },
      //     {
      //         httpStatus: 404,
      //         responsePagePath: '/404.html',
      //         ttl: cdk.Duration.minutes(5)
      //     }
      // ]
    })
  }
}
