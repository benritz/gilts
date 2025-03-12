import type { CdkCustomResourceEvent, CdkCustomResourceResponse, Context} from "aws-lambda"
import { CodePipelineClient, ListPipelineExecutionsCommand, PipelineExecutionStatus } from "@aws-sdk/client-codepipeline"

const { AWS_REGION } = process.env

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitForPipeline = async (
    client: CodePipelineClient, 
    pipelineName: string
): Promise<PipelineExecutionStatus|undefined> => {
    const ret = await client.send(new ListPipelineExecutionsCommand({pipelineName}))
                    
    const summaries = ret.pipelineExecutionSummaries

    if (!summaries || summaries.length === 0) {
        return undefined
    }

    const succeeded = summaries.filter((e) => e.status === PipelineExecutionStatus.Succeeded)
    if (succeeded.length > 0) {
        return PipelineExecutionStatus.Succeeded
    }

    const inprogress = summaries.filter((e) => 
        !(e.status === PipelineExecutionStatus.Failed || e.status === PipelineExecutionStatus.Cancelled))
    if (inprogress.length > 0) {
        return PipelineExecutionStatus.InProgress
    }

    return PipelineExecutionStatus.Failed
}

type Data = {
    PipelineStatus?: PipelineExecutionStatus
    Error?: unknown
}

export const handler = async (
    event: CdkCustomResourceEvent, 
    context: Context
): Promise<CdkCustomResourceResponse> => {
    const  { 
        StackId,
        RequestId,
        RequestType,
        LogicalResourceId,
        ResourceProperties: { pipelineName }
    } = event

    let Status = 'SUCCESS',
        Data: Data | undefined

    try {
        switch (RequestType) {
            case 'Create':
            case 'Update':
                // check that the pipeline has run successfully at least once 
                // otherwise wait for the pipeline execution
                const client = new CodePipelineClient({ region: AWS_REGION });

                try {
                    const maxChecks = 10    // 5 minutes§
                    let checks = 0

                    while (checks < maxChecks && Data === undefined) {                        
                        const status = await waitForPipeline(client, pipelineName)

                        console.log(`Pipeline ${pipelineName}: ${status || 'Unknown'} after ${checks} check/s`)

                        switch (status) {
                            case PipelineExecutionStatus.InProgress:
                            default:                                
                                await sleep(30000)
                                break;
                            case PipelineExecutionStatus.Succeeded:
                                Data = { PipelineStatus: status }
                                break;
                            case PipelineExecutionStatus.Failed:
                                Data = { PipelineStatus: status }
                                break;
                        }

                        ++checks                        
                    }
                } finally {
                    client.destroy();
                }
                
                break
                case 'Delete':
                    // nothing to do
                    break
                }
        
    } catch (Error) {
        Status = 'FAILED'
        Data = { Error }

        console.error(`Failed to check pipeline status: ${pipelineName}`, Error)
    }

    return {
        StackId,
        RequestId,
        LogicalResourceId, 
        PhysicalResourceId: `wait-for-pipeline-${pipelineName}`,
        Status,
        Data
    }
}