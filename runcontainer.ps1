$param1 = $args[0]

if ($param1 -ne "start" -and $param1 -ne "destructive") {
    Write-Host "Error: Invalid parameter. Acceptable parameters are 'start', or 'destructive'."
    exit 1
}

docker pull jslog/devcontainer-node-base:latest

if ($param1 -eq "destructive") {
    Write-Host "Destroying the existing container and the /app volume with it. Any work not committed and pushed is lost."

    $containers = docker ps -aq --filter volume=devcontainer-node-base
    if ($containers) {
        docker rm -f $containers
    }

    docker volume rm --force devcontainer-node-base
}

devcontainer up --remote-env GIT_USER_NAME=$(git config --get user.name) --remote-env GIT_USER_EMAIL=$(git config --get user.email) --workspace-folder .
