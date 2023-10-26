import type { StackProps } from 'aws-cdk-lib';
import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // バケット
    const bucket = new s3.Bucket(this, 'SampleBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      bucketName: 'frourio-cdk-starter-sample-bucket',
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // VPC
    const vpc = new ec2.Vpc(this, 'SampleVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      vpcName: 'cdk-sample-vpc',
    });

    // セキュリティグループ
    const securityGroup = new ec2.SecurityGroup(this, 'SampleSecurityGroup', {
      vpc,
      securityGroupName: 'cdk-vpc-ec2-security-group',
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'allow SSH');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'allow HTTP');

    const parameter = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'SampleParam', {
      parameterName: '/test/c',
    });

    // EC2インスタンス作成
    const createInstance = (
      id: string,
      name: string,
      subnet: ec2.SubnetSelection
    ): ec2.Instance => {
      return new ec2.Instance(this, id, {
        vpc,
        vpcSubnets: subnet,
        instanceType: new ec2.InstanceType(this.node.tryGetContext('instanceType')),
        machineImage: ec2.MachineImage.latestAmazonLinux2023(),
        securityGroup,
        instanceName: name,
        userData: ec2.UserData.custom(`#!/bin/bash
          VALUE=$(aws ssm get-parameter --name '${
            parameter.parameterName
          }' --with-decryption --query 'Parameter.Value' --output text --region ${this.node.tryGetContext(
          'region'
        )})
          echo "MY_ENV_VARIABLE=$VALUE" >> /etc/environment
          source /etc/environment
          sudo yum install -y nodejs 
          node -e "console.log('Running Node.js ' + process.version)"
        `),
        ssmSessionPermissions: true,
      });
    };

    const instance1 = createInstance(
      'SampleInstance6',
      'cdk-vpc-ec2-instance1',
      vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC })
    );

    const instance2 = createInstance(
      'SampleInstance15',
      'cdk-vpc-ec2-instance2',
      vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
    );

    parameter.grantRead(instance1);
    parameter.grantRead(instance2);

    // CodeCommitリポジトリの作成
    const repository = new codecommit.Repository(this, 'Repository', {
      repositoryName: 'NodeJsAppRepo',
    });

    // CodeBuildプロジェクトの作成
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject');
    // CodeDeployアプリケーションとデプロイグループの作成
    const application = new codedeploy.ServerApplication(this, 'Application', {
      applicationName: 'NodeJsApp',
    });
    const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, 'DeploymentGroup', {
      application,
      ec2InstanceTags: new codedeploy.InstanceTagSet({
        Name: [instance1.instanceId, instance2.instanceId],
      }),
      deploymentGroupName: 'NodeJsDeploymentGroup',
    });

    // CodePipelineの作成
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');
    new codepipeline.Pipeline(this, 'Pipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'Source',
              repository,
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Build',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeDeployServerDeployAction({
              actionName: 'Deploy',
              deploymentGroup,
              input: buildOutput,
            }),
          ],
        },
      ],
    });

    // CloudFormationに出力
    new CfnOutput(this, 'S3', { value: bucket.bucketName });
    new CfnOutput(this, 'VPC', { value: vpc.vpcId });
    new CfnOutput(this, 'Security Group', { value: securityGroup.securityGroupId });
    new CfnOutput(this, 'EC2Instance1', { value: instance1.instanceId });
    new CfnOutput(this, 'EC2Instance2', { value: instance2.instanceId });
  }
}
